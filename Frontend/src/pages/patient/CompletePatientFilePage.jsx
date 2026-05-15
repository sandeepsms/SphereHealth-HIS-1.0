/**
 * CompletePatientFilePage.jsx
 * ════════════════════════════════════════════════════════════════
 * One page. Every clinical record this patient has, in order, ready
 * to read or print as the patient's complete file.
 *
 * Mounted at: /patient-file/:uhid?role=doctor|nurse
 *
 * Sections (all rendered, never lazy):
 *   • Identity + Admission summary (banner)
 *   • Completeness strip (NABH gap radar)
 *   • Sticky section nav
 *   • Initial Assessment (Doctor + Nursing)
 *   • Doctor Notes (signed + draft)
 *   • Nursing Notes (categorised)
 *   • Orders + MAR
 *   • Vitals + I/O
 *   • Investigations
 *   • Consents
 *   • MLC
 *   • Bed Transfers + Handovers
 *   • Discharge Summary
 *   • Billing summary
 *   • Activity Log (catch-all UI audit feed)
 *
 * Print: just hit Ctrl-P. The pf-* CSS handles print sections.
 * Role tinting: ?role=nurse swaps to teal; default is doctor purple.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import "./patient-file.css";

const BASE = API_ENDPOINTS.BASE;

/* ── Formatters ─────────────────────────────────────────────── */
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
    return d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  } catch { return "—"; }
};
const fmtCur = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const truthy = (v) => v != null && v !== "" && (Array.isArray(v) ? v.length > 0 : true);

/* ── Atom: Field ────────────────────────────────────────────── */
function Field({ label, value, wide }) {
  return (
    <div className={`pf-field ${wide ? "pf-field--wide" : ""}`}>
      <span className="pf-field__label">{label}</span>
      <span className="pf-field__value">{truthy(value) ? value : "—"}</span>
    </div>
  );
}

/* ── Atom: Section ──────────────────────────────────────────── */
function Section({ id, icon, title, sub, count, children }) {
  return (
    <section id={id} className="pf-section">
      <header className="pf-section__head">
        <div className="pf-section__icon">{icon}</div>
        <div>
          <div className="pf-section__title">{title}</div>
          {sub && <div className="pf-section__sub">{sub}</div>}
        </div>
        {count != null && <span className="pf-section__count">{count}</span>}
      </header>
      <div className="pf-section__body">{children}</div>
    </section>
  );
}

function Empty({ icon = "📄", msg = "No records yet" }) {
  return (
    <div className="pf-empty">
      <div className="pf-empty__icon">{icon}</div>
      <div>{msg}</div>
    </div>
  );
}

/* ── Sections ───────────────────────────────────────────────── */
function IdentityBanner({ patient, currentAdmission, role, onBack, onPrint }) {
  const initials = (patient?.fullName || patient?.firstName || "P")
    .split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const age = patient?.age || patient?.dateOfBirth
    ? `${patient.age || Math.floor((Date.now() - new Date(patient.dateOfBirth)) / (365.25 * 24 * 3600 * 1000))}y`
    : "—";
  return (
    <div className="pf-banner">
      <div className="pf-banner__id">
        <div className="pf-banner__avatar">{initials}</div>
        <div>
          <div className="pf-banner__name">{patient?.title ? `${patient.title} ` : ""}{patient?.fullName || "—"}</div>
          <div className="pf-banner__sub">
            UHID {patient?.UHID} · {age} · {patient?.gender || "—"}
            {patient?.bloodGroup ? ` · ${patient.bloodGroup}` : ""}
            {patient?.contactNumber ? ` · ☎ ${patient.contactNumber}` : ""}
          </div>
        </div>
      </div>
      <div className="pf-banner__stats">
        <div className="pf-banner__stat">
          <span className="pf-banner__stat-label">Admission</span>
          <span className="pf-banner__stat-val">{currentAdmission?.admissionNumber || "—"}</span>
        </div>
        <div className="pf-banner__stat">
          <span className="pf-banner__stat-label">Bed</span>
          <span className="pf-banner__stat-val">{currentAdmission?.bedNumber || "—"}</span>
        </div>
        <div className="pf-banner__stat">
          <span className="pf-banner__stat-label">Doctor</span>
          <span className="pf-banner__stat-val">{currentAdmission?.attendingDoctor || "—"}</span>
        </div>
        <div className="pf-banner__stat">
          <span className="pf-banner__stat-label">Role View</span>
          <span className="pf-banner__stat-val">{role === "nurse" ? "Nursing" : "Doctor"}</span>
        </div>
        <div className="pf-banner__actions">
          <button className="pf-banner__btn" onClick={onBack}>← Back</button>
          <button className="pf-banner__btn pf-banner__btn--solid" onClick={onPrint}>🖨 Print Complete File</button>
        </div>
      </div>
    </div>
  );
}

function Completeness({ completeness }) {
  const items = [
    { key: "admission",          label: "Admission recorded" },
    { key: "doctorInitialNote",  label: "Doctor initial note" },
    { key: "nurseInitialNote",   label: "Nurse initial note" },
    { key: "vitalsRecorded",     label: "Vitals captured" },
    { key: "orders",             label: "Orders placed" },
    { key: "consents",           label: "Consent on file" },
    { key: "investigations",     label: "Investigations ordered" },
    { key: "handoverDone",       label: "Handover documented" },
    { key: "dischargeFinalized", label: "Discharge finalised" },
  ];
  return (
    <div className="pf-completeness">
      {items.map((it) => {
        const ok = !!completeness?.[it.key];
        return (
          <div key={it.key} className={`pf-completeness__item ${ok ? "pf-completeness__item--ok" : "pf-completeness__item--warn"}`}>
            <span className="pf-completeness__dot" />
            <span>{ok ? "✓ " : "⚠ "}{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function AdmissionSection({ admission }) {
  if (!admission) return <Empty icon="🛏" msg="No admission on file" />;
  return (
    <div className="pf-detail-grid">
      <Field label="IPD / Admission No." value={admission.admissionNumber} />
      <Field label="Admission Type"      value={admission.admissionType} />
      <Field label="Admitted On"         value={fmtDT(admission.admissionDate)} />
      <Field label="Status"              value={admission.status} />
      <Field label="Attending Doctor"    value={admission.attendingDoctor} />
      <Field label="Department"          value={admission.department} />
      <Field label="Bed / Ward"          value={[admission.bedNumber, admission.wardName].filter(Boolean).join(" — ")} />
      <Field label="Room Category"       value={admission.roomCategory} />
      <Field label="Reason for Admission" value={admission.reasonForAdmission} wide />
      <Field label="Provisional Diagnosis" value={admission.provisionalDiagnosis} wide />
      {admission.dischargeDate && (
        <Field label="Discharged On" value={fmtDT(admission.dischargeDate)} />
      )}
    </div>
  );
}

function NoteList({ notes, kind, emptyMsg }) {
  if (!notes?.length) return <Empty msg={emptyMsg || "No records yet"} />;
  return notes.map((n) => (
    <div key={n._id} className={`pf-record pf-record--${kind}`}>
      <div className="pf-record__head">
        <span className="pf-record__title">
          {n.doctorName || n.nurseName || "Staff"} — {n.noteType || "note"}
        </span>
        <span className="pf-record__time">{fmtDT(n.visitDate || n.createdAt)}</span>
        {n.status && <span className={`pf-badge ${n.status === "signed" ? "pf-badge--ok" : "pf-badge--warn"}`}>{n.status}</span>}
        {n.shift && <span className="pf-badge pf-badge--neutral">{n.shift}</span>}
      </div>
      <div className="pf-record__body">
        {n.soap && (
          <>
            {n.soap.subjective && <p><strong>S:</strong> {n.soap.subjective}</p>}
            {n.soap.objective  && <p><strong>O:</strong> {n.soap.objective}</p>}
            {n.soap.assessment && <p><strong>A:</strong> {n.soap.assessment}</p>}
            {n.soap.plan       && <p><strong>P:</strong> {n.soap.plan}</p>}
          </>
        )}
        {n.provisionalDiagnosis && <p><strong>Provisional Dx:</strong> {n.provisionalDiagnosis}</p>}
        {n.finalDiagnosis       && <p><strong>Final Dx:</strong> {n.finalDiagnosis}</p>}
        {n.remarks  && <p>{n.remarks}</p>}
        {n.note     && <p>{n.note}</p>}
        {n.noteText && <p>{n.noteText}</p>}
        {n.content  && <p>{n.content}</p>}
        {n.signedByName && <p style={{ fontStyle: "italic", color: "var(--pf-muted)" }}>Signed by {n.signedByName}{n.signedByReg ? ` (Reg ${n.signedByReg})` : ""} on {fmtDT(n.signedAt)}</p>}
      </div>
    </div>
  ));
}

function OrdersSection({ orders }) {
  if (!orders?.length) return <Empty icon="💊" msg="No orders placed yet" />;
  return (
    <table className="pf-table pf-table--compact">
      <thead>
        <tr>
          <th>When</th><th>Drug / Order</th><th>Dose / Rate</th>
          <th>Route</th><th>Frequency</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o._id}>
            <td>{fmtDT(o.orderedAt || o.createdAt)}</td>
            <td>
              <strong>{o.orderDetails?.medicineName || o.orderDetails?.displayName || o.orderType || "—"}</strong>
              {o.hamFlag && <span className="pf-badge pf-badge--danger" style={{ marginLeft: 6 }}>HAM ⚠</span>}
            </td>
            <td>{o.orderDetails?.dose || o.currentRate || "—"}</td>
            <td>{o.orderDetails?.route || "—"}</td>
            <td>{o.orderDetails?.frequency || "—"}</td>
            <td>
              <span className={`pf-badge ${
                ["Completed", "InProgress"].includes(o.status) ? "pf-badge--ok" :
                ["Stopped", "Cancelled"].includes(o.status)    ? "pf-badge--danger" :
                o.status === "OnHold"                          ? "pf-badge--warn" :
                "pf-badge--neutral"
              }`}>{o.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VitalsSection({ vitals, nurseNotes }) {
  // Merge dedicated VitalSheet rows + vitals embedded inside nurse notes,
  // dedupe on (timestamp minute, BP, pulse).
  const merged = useMemo(() => {
    const rows = [];
    vitals.forEach((v) => rows.push({
      when: v.recordedAt || v.createdAt,
      by: v.recordedBy || v.nurseName || "—",
      bp: v.bp ? `${v.bp.systolic || "—"}/${v.bp.diastolic || "—"}` : "—",
      pulse: v.pulse || "—", temp: v.temperature || v.temp || "—",
      rr: v.rr || v.respiratoryRate || "—", spo2: v.spo2 || "—",
      bsl: v.bsl || v.bloodSugar || "—", gcs: v.gcs || "—",
    }));
    nurseNotes.forEach((n) => {
      if (!n.vitals) return;
      rows.push({
        when: n.createdAt,
        by: n.nurseName || "—",
        bp: n.vitals.bp ? `${n.vitals.bp.systolic || "—"}/${n.vitals.bp.diastolic || "—"}` : "—",
        pulse: n.vitals.pulse || "—", temp: n.vitals.temp || "—",
        rr: n.vitals.rr || "—", spo2: n.vitals.spo2 || "—",
        bsl: n.vitals.bsl || "—", gcs: n.vitals.gcs || "—",
      });
    });
    rows.sort((a, b) => new Date(b.when) - new Date(a.when));
    // Dedupe by minute precision
    const seen = new Set();
    return rows.filter((r) => {
      const key = `${new Date(r.when).toISOString().slice(0, 16)}|${r.bp}|${r.pulse}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [vitals, nurseNotes]);

  if (!merged.length) return <Empty icon="📈" msg="No vitals captured" />;
  return (
    <table className="pf-table pf-table--compact">
      <thead>
        <tr>
          <th>When</th><th>By</th><th>BP</th><th>Pulse</th>
          <th>Temp</th><th>RR</th><th>SpO₂</th><th>BSL</th><th>GCS</th>
        </tr>
      </thead>
      <tbody>
        {merged.slice(0, 200).map((r, i) => (
          <tr key={i}>
            <td>{fmtDT(r.when)}</td><td>{r.by}</td>
            <td>{r.bp}</td><td>{r.pulse}</td><td>{r.temp}</td>
            <td>{r.rr}</td><td>{r.spo2}</td><td>{r.bsl}</td><td>{r.gcs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConsentSection({ consents }) {
  if (!consents?.length) return <Empty icon="📝" msg="No consent forms yet" />;
  return consents.map((c) => (
    <div key={c._id} className="pf-record pf-record--consent">
      <div className="pf-record__head">
        <span className="pf-record__title">{c.consentTitle || c.consentType}</span>
        <span className="pf-record__time">{fmtDT(c.createdAt)}</span>
        <span className={`pf-badge ${
          c.status === "SIGNED"  ? "pf-badge--ok"   :
          c.status === "REFUSED" ? "pf-badge--danger" :
          c.status === "REVOKED" ? "pf-badge--warn" :
          "pf-badge--neutral"
        }`}>{c.status}</span>
      </div>
      <div className="pf-record__body">
        <p><strong>Given by:</strong> {c.consentGivenBy} {c.guardianName ? `(${c.guardianName} — ${c.guardianRelation || ""})` : ""}</p>
        {c.procedureDescription && <p><strong>Procedure:</strong> {c.procedureDescription}</p>}
        {c.signedByName && <p><em>Signed by {c.signedByName} on {fmtDT(c.signedAt)}</em></p>}
        {c.refusalReason && <p><strong>Refusal reason:</strong> {c.refusalReason}</p>}
      </div>
    </div>
  ));
}

function InvestigationSection({ investigations }) {
  if (!investigations?.length) return <Empty icon="🧪" msg="No investigations ordered" />;
  return investigations.map((o) => (
    <div key={o._id} className="pf-record">
      <div className="pf-record__head">
        <span className="pf-record__title">Order — {fmtDate(o.createdAt)}</span>
        <span className={`pf-badge ${o.orderStatus === "COMPLETED" ? "pf-badge--ok" : "pf-badge--warn"}`}>{o.orderStatus}</span>
        <span className="pf-record__time">By {o.doctorName || "—"}</span>
      </div>
      <table className="pf-table pf-table--compact">
        <thead><tr><th>Test</th><th>Sample</th><th>Status</th><th>Result</th></tr></thead>
        <tbody>
          {(o.items || []).map((it, i) => (
            <tr key={i}>
              <td>{it.investigationName}</td>
              <td>{it.sampleStatus}</td>
              <td>{it.resultStatus}</td>
              <td>{(it.results || []).map((r) => `${r.parameter}: ${r.value} ${r.unit || ""}`).join("; ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ));
}

// Dietician's nutritional assessments + assigned diet plans for this
// patient. Each card shows the assessment vitals, the active template
// (or "Custom"), target macros, customisations, meal snapshot count,
// and a follow-up date. Read-only — this page is the doctor / nurse /
// admin view of the file; writes happen in /dietitian.
function DietPlansSection({ dietPlans }) {
  if (!dietPlans?.length) return <Empty icon="🥗" msg="No dietician assessments or diet plans on file" />;
  return dietPlans.map((d) => {
    const a = d.assessment || {};
    const p = d.plan || {};
    const isActive = d.status === "active";
    return (
      <div key={d._id} className="pf-record" style={{ borderLeftColor: isActive ? "#16a34a" : "#94a3b8", borderLeftWidth: 4, borderLeftStyle: "solid" }}>
        <div className="pf-record__head">
          <span className="pf-record__title">
            🥗 {p.templateName || "Custom plan"}{p.templateCode ? <span style={{ marginLeft: 6, fontFamily: "monospace", fontSize: 10, opacity: 0.7 }}>[{p.templateCode}]</span> : null}
          </span>
          <span className={`pf-badge pf-badge--${isActive ? "ok" : "warn"}`}>{(d.status || "—").toUpperCase()}</span>
          <span className="pf-record__time">{fmtDate(d.assignedAt || d.createdAt)}</span>
        </div>
        <div className="pf-record__body">
          {/* Assessment snapshot — only show populated fields */}
          {(a.height || a.weight || a.bmi || a.bp || a.bloodSugarFasting || a.creatinine || a.conditions?.length) && (
            <div style={{ marginBottom: 8, padding: "6px 10px", background: "#f0fdf4", borderRadius: 4, fontSize: 12, color: "#166534" }}>
              <strong>Assessment:</strong>{" "}
              {a.height && <>H {a.height} cm · </>}
              {a.weight && <>W {a.weight} kg · </>}
              {a.bmi && <>BMI <strong>{a.bmi}</strong> · </>}
              {a.bp && <>BP {a.bp} · </>}
              {a.bloodSugarFasting && <>FBS {a.bloodSugarFasting} · </>}
              {a.hba1c && <>HbA1c {a.hba1c}% · </>}
              {a.creatinine && <>Cr {a.creatinine} · </>}
              {a.hemoglobin && <>Hb {a.hemoglobin}</>}
              {a.conditions?.length > 0 && <div style={{ marginTop: 4 }}><strong>Conditions:</strong> {a.conditions.join(", ")}</div>}
              {a.allergies?.length > 0 && <div><strong>Allergies:</strong> {a.allergies.join(", ")}</div>}
            </div>
          )}
          {/* Plan targets */}
          <div className="pf-detail-grid">
            {p.targetCalories != null  && <Field label="Target calories"  value={`${p.targetCalories} kcal/day`} />}
            {p.targetProtein  != null  && <Field label="Target protein"   value={`${p.targetProtein} g/day`} />}
            {p.fluidRestriction != null && <Field label="Fluid limit"     value={`${p.fluidRestriction} ml/day`} />}
            {p.saltRestriction  != null && <Field label="Salt limit"      value={`${p.saltRestriction} g/day`} />}
            {p.meals?.length > 0       && <Field label="Meal schedule"    value={`${p.meals.length} meals snapshotted`} />}
            {d.followUpAt              && <Field label="Follow-up"        value={fmtDate(d.followUpAt)} />}
          </div>
          {p.customisations && <p style={{ fontSize: 12 }}><strong>Customisations:</strong> {p.customisations}</p>}
          {p.notes && <p style={{ fontSize: 12 }}><strong>Plan notes:</strong> {p.notes}</p>}
          {a.foodPreference && <p style={{ fontSize: 11.5, color: "#6b7280", margin: "4px 0 0" }}>Food preference: {a.foodPreference}{a.appetite ? ` · appetite ${a.appetite}` : ""}{a.swallowing && a.swallowing !== "normal" ? ` · swallowing: ${a.swallowing}` : ""}</p>}
        </div>
      </div>
    );
  });
}

function MLCSection({ mlc }) {
  if (!mlc?.length) return <Empty icon="⚖" msg="No MLC on file" />;
  return mlc.map((m) => (
    <div key={m._id} className="pf-record pf-record--mlc">
      <div className="pf-record__head">
        <span className="pf-record__title">MLR {m.mlrNumber}</span>
        <span className="pf-record__time">{fmtDT(m.createdAt)}</span>
        <span className={`pf-badge pf-badge--${m.status === "CLOSED" ? "ok" : "warn"}`}>{m.status}</span>
      </div>
      <div className="pf-record__body">
        <p><strong>Nature of injury:</strong> {m.natureOfInjury}</p>
        <p><strong>Police informed:</strong> {m.policeInformed ? "Yes" : "No"}</p>
        {m.policeStation && <p><strong>PS:</strong> {m.policeStation} | FIR: {m.firNumber || "—"}</p>}
      </div>
    </div>
  ));
}

function DischargeSection({ dischargeSummary }) {
  const ds = dischargeSummary?.[0];
  if (!ds) return <Empty icon="🏥" msg="Discharge not yet documented" />;
  return (
    <div>
      <div className="pf-detail-grid">
        <Field label="Status"          value={ds.status} />
        <Field label="Discharge Type"  value={ds.dischargeType} />
        <Field label="Condition"       value={ds.conditionOnDischarge} />
        <Field label="Discharge Date"  value={fmtDT(ds.dischargeDate)} />
        <Field label="Final Diagnosis" value={ds.finalDiagnosis} wide />
        <Field label="Course in Hospital" value={ds.courseInHospital} wide />
        <Field label="Follow-up" value={ds.followUpInstructions} wide />
      </div>
      {ds.medicationsOnDischarge?.length > 0 && (
        <>
          <h4 style={{ margin: "14px 0 8px", color: "var(--pf-accent-d)" }}>Medications on discharge</h4>
          <table className="pf-table pf-table--compact">
            <thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th></tr></thead>
            <tbody>
              {ds.medicationsOnDischarge.map((m, i) => (
                <tr key={i}>
                  <td>{m.medicineName}</td><td>{m.dose}</td><td>{m.route}</td>
                  <td>{m.frequency}</td><td>{m.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function BillingSection({ bills }) {
  if (!bills?.length) return <Empty icon="💰" msg="No bills yet" />;
  const totals = bills.reduce((acc, b) => {
    acc.gross += b.grossAmount || 0;
    acc.paid  += b.advancePaid || 0;
    acc.due   += b.balanceAmount || 0;
    return acc;
  }, { gross: 0, paid: 0, due: 0 });
  return (
    <>
      <div className="pf-detail-grid" style={{ marginBottom: 12 }}>
        <Field label="Total Gross" value={fmtCur(totals.gross)} />
        <Field label="Total Paid"  value={fmtCur(totals.paid)} />
        <Field label="Outstanding" value={fmtCur(totals.due)} />
      </div>
      <table className="pf-table pf-table--compact">
        <thead><tr><th>Bill No.</th><th>Visit</th><th>Status</th><th>Net</th><th>Paid</th><th>Due</th></tr></thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b._id}>
              <td>{b.billNumber || "(draft)"}</td>
              <td>{b.visitType}</td>
              <td><span className={`pf-badge pf-badge--${
                b.billStatus === "PAID" ? "ok" :
                b.billStatus === "CANCELLED" || b.billStatus === "REFUNDED" ? "danger" :
                "warn"
              }`}>{b.billStatus}</span></td>
              <td>{fmtCur(b.netAmount)}</td>
              <td>{fmtCur(b.advancePaid)}</td>
              <td>{fmtCur(b.balanceAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ActivityFeed({ activityLog }) {
  if (!activityLog?.length) return <Empty icon="🪵" msg="No activity recorded yet" />;
  return (
    <div className="pf-timeline">
      {activityLog.slice(0, 200).map((a) => (
        <div key={a._id} className="pf-timeline__item">
          <div className="pf-timeline__dot" />
          <div className="pf-timeline__time">{fmtDT(a.createdAt)}</div>
          <div className="pf-timeline__label">
            <strong>{a.userName || "System"}</strong> — {a.module}/{a.action}
            <span className="pf-timeline__kind">{a.area || ""}</span>
          </div>
          {a.summary && <div style={{ fontSize: 11, color: "var(--pf-muted)", marginTop: 2 }}>{a.summary}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── Print template ─────────────────────────────────────────── */
function PrintLetterhead({ patient, currentAdmission, role }) {
  const initials = (patient?.fullName || "P").split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const ageDisp = patient?.age || (patient?.dateOfBirth
    ? Math.floor((Date.now() - new Date(patient.dateOfBirth)) / (365.25 * 24 * 3600 * 1000)) + "y"
    : "—");
  return (
    <header className="pf-print-letterhead">
      <div className="pf-print-letterhead__brand">
        <div className="pf-print-letterhead__logo">S</div>
        <div>
          <div className="pf-print-letterhead__hospital">SphereHealth Hospital</div>
          <div className="pf-print-letterhead__sub">NABH Accredited · Hospital Information System</div>
        </div>
      </div>
      <div className="pf-print-letterhead__doc">
        <div className="pf-print-letterhead__doc-title">Complete Patient File</div>
        <div className="pf-print-letterhead__doc-sub">
          {role === "nurse" ? "Nursing View" : "Doctor View"} ·
          Generated {new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <div className="pf-print-patient">
        <div className="pf-print-patient__avatar">{initials}</div>
        <div className="pf-print-patient__main">
          <div className="pf-print-patient__name">{patient?.title ? `${patient.title} ` : ""}{patient?.fullName || "—"}</div>
          <div className="pf-print-patient__meta">
            <span><strong>UHID:</strong> {patient?.UHID}</span>
            <span><strong>Age / Sex:</strong> {ageDisp} / {patient?.gender || "—"}</span>
            {patient?.bloodGroup && <span><strong>Blood:</strong> {patient.bloodGroup}</span>}
            {patient?.contactNumber && <span><strong>☎</strong> {patient.contactNumber}</span>}
          </div>
        </div>
        <div className="pf-print-patient__adm">
          <div><strong>IPD No.:</strong> {currentAdmission?.admissionNumber || "—"}</div>
          <div><strong>Bed / Ward:</strong> {[currentAdmission?.bedNumber, currentAdmission?.wardName].filter(Boolean).join(" — ") || "—"}</div>
          <div><strong>Doctor:</strong> {currentAdmission?.attendingDoctor || "—"}</div>
          <div><strong>Admitted:</strong> {currentAdmission?.admissionDate ? fmtDT(currentAdmission.admissionDate) : "—"}</div>
        </div>
      </div>
    </header>
  );
}

function PrintBody({ data, docInitial, nurseInitial, docOther, nurseOther }) {
  const { currentAdmission, doctorOrders, vitals, nurseNotes,
    consents, investigations, mlc, dischargeSummary, bills, activityLog,
    bedTransfers, shiftHandovers, timeline } = data;
  return (
    <main className="pf-print-body">
      <PrintSection title="1. Admission Summary">
        <AdmissionSection admission={currentAdmission} />
      </PrintSection>

      <PrintSection title="2. Initial Assessment — Doctor">
        <NoteList notes={docInitial} kind="doctor" emptyMsg="Doctor initial assessment not recorded" />
      </PrintSection>

      <PrintSection title="3. Initial Assessment — Nursing">
        <NoteList notes={nurseInitial} kind="nurse" emptyMsg="Nursing initial assessment not recorded" />
      </PrintSection>

      <PrintSection title="4. Doctor Notes">
        <NoteList notes={docOther} kind="doctor" emptyMsg="No doctor notes on file" />
      </PrintSection>

      <PrintSection title="5. Nursing Notes">
        <NoteList notes={nurseOther} kind="nurse" emptyMsg="No nursing notes on file" />
      </PrintSection>

      <PrintSection title="6. Orders + MAR">
        <OrdersSection orders={doctorOrders} />
      </PrintSection>

      <PrintSection title="7. Vital Trends">
        <VitalsSection vitals={vitals} nurseNotes={nurseNotes} />
      </PrintSection>

      <PrintSection title="8. Investigations">
        <InvestigationSection investigations={investigations} />
      </PrintSection>

      <PrintSection title="9. Consent Forms">
        <ConsentSection consents={consents} />
      </PrintSection>

      {/* Dietician — nutritional assessments + assigned plans. Shown
          whenever any plan exists so the treating doctor / nurse on
          rounds can see what nutritional orders are in effect. */}
      <PrintSection title="9a. Dietician — Diet Plans">
        <DietPlansSection dietPlans={dietPlans} />
      </PrintSection>

      {mlc?.length > 0 && (
        <PrintSection title="10. Medico-Legal Cases">
          <MLCSection mlc={mlc} />
        </PrintSection>
      )}

      <PrintSection title="11. Bed Transfers + Shift Handovers">
        {(bedTransfers?.length || 0) === 0 && (shiftHandovers?.length || 0) === 0
          ? <Empty icon="🔄" msg="No handovers recorded" />
          : (
            <>
              {bedTransfers?.map((t) => (
                <div key={t._id} className="pf-record">
                  <div className="pf-record__head">
                    <span className="pf-record__title">Bed transfer — {t.fromBed} → {t.toBed}</span>
                    <span className="pf-record__time">{fmtDT(t.createdAt)}</span>
                    <span className={`pf-badge pf-badge--${t.status === "Complete" ? "ok" : "warn"}`}>{t.status}</span>
                  </div>
                  <div className="pf-record__body">
                    {t.shiftingNotes && <p><strong>Doctor notes:</strong> {t.shiftingNotes}</p>}
                    {t.handoverNotes && <p><strong>Nurse handover:</strong> {t.handoverNotes}</p>}
                  </div>
                </div>
              ))}
              {shiftHandovers?.map((h) => (
                <div key={h._id} className="pf-record pf-record--nurse">
                  <div className="pf-record__head">
                    <span className="pf-record__title">Shift handover — {h.outgoingShift} → {h.incomingShift}</span>
                    <span className="pf-record__time">{fmtDT(h.createdAt)}</span>
                  </div>
                  <div className="pf-record__body">
                    {h.situation      && <p><strong>S:</strong> {h.situation}</p>}
                    {h.background     && <p><strong>B:</strong> {h.background}</p>}
                    {h.assessment     && <p><strong>A:</strong> {h.assessment}</p>}
                    {h.recommendation && <p><strong>R:</strong> {h.recommendation}</p>}
                  </div>
                </div>
              ))}
            </>
          )
        }
      </PrintSection>

      <PrintSection title="12. Discharge Summary">
        <DischargeSection dischargeSummary={dischargeSummary} />
      </PrintSection>

      <PrintSection title="13. Billing Summary">
        <BillingSection bills={bills} />
      </PrintSection>

      <PrintSection title="14. Activity / Audit Trail (latest 50)">
        <ActivityFeed activityLog={(activityLog || []).slice(0, 50)} />
      </PrintSection>
    </main>
  );
}

function PrintSection({ title, children }) {
  return (
    <section className="pf-print-section">
      <h2 className="pf-print-section__title">{title}</h2>
      <div className="pf-print-section__body">{children}</div>
    </section>
  );
}

function PrintFooter({ uhid, role }) {
  // Roadmap F23 — per-page QR back-link. The browser repeats this footer
  // via @page running-element on every printed page, so any single page
  // photographed in isolation still links back to the live source.
  const qrUrl = uhid
    ? `https://api.qrserver.com/v1/create-qr-code/?size=80x80&margin=2&data=${encodeURIComponent(
        `${typeof window !== "undefined" ? window.location.origin : ""}/patient-file/${uhid}?role=${role}`
      )}`
    : null;
  return (
    <footer className="pf-print-footer">
      {qrUrl && <img src={qrUrl} alt={`Verify online — UHID ${uhid}`} className="pf-print-footer__qr" />}
      <div style={{ flex: 1 }}>
        <div>© SphereHealth Hospital · Computer-generated medical record · NABH AAC.7</div>
        <div style={{ fontSize: 9, opacity: .7, marginTop: 2 }}>
          PDF/A-2b archival — embed fonts via printer. Verify printed copy by scanning QR or visiting
          /patient-file/{uhid}
        </div>
      </div>
      <span>Printed {new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
    </footer>
  );
}

/* ── Page ───────────────────────────────────────────────────── */
export default function CompletePatientFilePage() {
  const { uhid } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const role = (search.get("role") || "doctor").toLowerCase();
  const [data, setData] = useState(null);
  const [err, setErr]   = useState("");
  const [active, setActive] = useState("admission");

  // Print / PDF / "print only" rendering modes activated via query string.
  // ?autoprint=1   → trigger window.print() right after data lands.
  // ?mode=print    → drop SPA chrome (sticky nav, hover effects) and render
  //                  the whole document inline, top-to-bottom, A4-ready.
  //                  Set by the popup window the Print button opens so the
  //                  patient panel itself stays interactive in the parent tab.
  const autoprint = search.get("autoprint") === "1";
  const printMode = autoprint || search.get("mode") === "print";

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr("");
    axios.get(`${BASE}/patient-file/${uhid}/complete`)
      .then((res) => { if (!cancelled) setData(res.data?.data || null); })
      .catch((e) => { if (!cancelled) setErr(e.response?.data?.message || e.message); });
    return () => { cancelled = true; };
  }, [uhid]);

  // Fire the browser print dialog once the data is rendered. We delay a beat
  // so React commits the DOM + any signature <img> tags get a chance to
  // start loading. afterprint closes the popup (no-op if it's the main tab).
  useEffect(() => {
    if (!autoprint || !data) return;
    const handle = setTimeout(() => {
      window.print();
      const close = () => { try { window.close(); } catch {} };
      window.addEventListener("afterprint", close, { once: true });
    }, 500);
    return () => clearTimeout(handle);
  }, [autoprint, data]);

  /* Scroll-spy for the sticky nav */
  useEffect(() => {
    if (!data) return;
    const ids = ["admission","initial","doctor-notes","nurse-notes","orders","vitals","investigations","consents","diet","mlc","handover","discharge","billing","activity","timeline"];
    const onScroll = () => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= 80 && rect.bottom > 80) { setActive(id); break; }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [data]);

  if (err) {
    return (
      <div className={`pf-page pf-tint--${role === "nurse" ? "nurse" : "doctor"}`}>
        <div className="pf-container">
          <div className="pf-section">
            <div className="pf-section__body">
              <Empty icon="⚠" msg={`Could not load patient file — ${err}`} />
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button className="pf-banner__btn pf-banner__btn--solid" onClick={() => navigate(-1)}>← Back</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={`pf-page pf-tint--${role === "nurse" ? "nurse" : "doctor"}`}>
        <div className="pf-container">
          <div className="pf-loading"><div className="pf-spinner" /></div>
        </div>
      </div>
    );
  }

  const { patient, currentAdmission, doctorNotes, nurseNotes, doctorOrders, vitals,
    consents, investigations, mlc, dischargeSummary, bills, activityLog,
    bedTransfers, shiftHandovers, dietPlans, timeline, completeness } = data;

  const docInitial   = doctorNotes.filter((n) => /initial/i.test(n.noteType || ""));
  const nurseInitial = nurseNotes.filter((n)  => /initial/i.test(n.noteType || ""));
  const docOther     = doctorNotes.filter((n) => !/initial/i.test(n.noteType || ""));
  const nurseOther   = nurseNotes.filter((n)  => !/initial/i.test(n.noteType || ""));

  const navItems = [
    { id: "admission",     label: "Admission",          icon: "🛏", count: data.admissions?.length },
    { id: "initial",       label: "Initial Assessment", icon: "🩺", count: docInitial.length + nurseInitial.length },
    { id: "doctor-notes",  label: "Doctor Notes",       icon: "👨‍⚕️", count: docOther.length },
    { id: "nurse-notes",   label: "Nurse Notes",        icon: "👩‍⚕️", count: nurseOther.length },
    { id: "orders",        label: "Orders + MAR",       icon: "💊", count: doctorOrders.length },
    { id: "vitals",        label: "Vitals + I/O",       icon: "📈", count: vitals.length },
    { id: "investigations",label: "Investigations",     icon: "🧪", count: investigations.length },
    { id: "consents",      label: "Consents",           icon: "📝", count: consents.length },
    { id: "diet",          label: "Diet Plans",         icon: "🥗", count: dietPlans?.length || 0 },
    { id: "mlc",           label: "MLC",                icon: "⚖", count: mlc.length },
    { id: "handover",      label: "Handovers",          icon: "🔄", count: (bedTransfers?.length || 0) + (shiftHandovers?.length || 0) },
    { id: "discharge",     label: "Discharge",          icon: "🏥", count: dischargeSummary.length },
    { id: "billing",       label: "Billing",            icon: "💰", count: bills.length },
    { id: "activity",      label: "Activity Log",       icon: "🪵", count: activityLog.length },
    { id: "timeline",      label: "Timeline",           icon: "📅", count: timeline.length },
  ];

  // ── Print-mode renders a clean linear A4 document with letterhead. No
  // sticky nav, no completeness strip, no scroll-spy. Everything visible
  // top-to-bottom so the browser print dialog gets the entire file in one
  // continuous stream.
  if (printMode) {
    return (
      <div className={`pf-page pf-print-mode pf-tint--${role === "nurse" ? "nurse" : "doctor"}`}>
        <PrintLetterhead patient={patient} currentAdmission={currentAdmission} role={role} />
        <PrintBody data={data} docInitial={docInitial} nurseInitial={nurseInitial} docOther={docOther} nurseOther={nurseOther} />
        <PrintFooter uhid={uhid} role={role} />
      </div>
    );
  }

  return (
    <div className={`pf-page pf-tint--${role === "nurse" ? "nurse" : "doctor"}`}>
      <div className="pf-container">
        <IdentityBanner
          patient={patient}
          currentAdmission={currentAdmission}
          role={role}
          onBack={() => navigate(-1)}
          onPrint={() => window.open(`/patient-file/${uhid}?role=${role}&autoprint=1`, "_blank", "noopener,width=1100,height=900")}
        />
        <Completeness completeness={completeness} />

        <div className="pf-grid">
          <nav className="pf-nav" aria-label="Patient file sections">
            <div className="pf-nav__title">Jump to</div>
            {navItems.map((it) => (
              <button
                key={it.id}
                className={`pf-nav__link ${active === it.id ? "pf-nav__link--active" : ""}`}
                onClick={() => {
                  const el = document.getElementById(it.id);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <span>{it.icon}</span>
                <span>{it.label}</span>
                {it.count != null && <span className="pf-nav__badge">{it.count}</span>}
              </button>
            ))}
          </nav>

          <div>
            <Section id="admission" icon="🛏" title="Admission Summary" sub="Current visit on file">
              <AdmissionSection admission={currentAdmission} />
            </Section>

            <Section id="initial" icon="🩺" title="Initial Assessment" sub="NABH COP.2 + IPSG.6 — combined intake">
              <h4 style={{ margin: "0 0 8px", color: "var(--pf-accent-d)" }}>Doctor — Initial Assessment</h4>
              <NoteList notes={docInitial} kind="doctor" emptyMsg="Doctor initial assessment not recorded" />
              <h4 style={{ margin: "16px 0 8px", color: "var(--pf-accent-d)" }}>Nursing — Initial Assessment</h4>
              <NoteList notes={nurseInitial} kind="nurse" emptyMsg="Nursing initial assessment not recorded" />
            </Section>

            <Section id="doctor-notes" icon="👨‍⚕️" title="Doctor Notes" sub="Progress, ICU, procedure, consultation" count={docOther.length}>
              <NoteList notes={docOther} kind="doctor" emptyMsg="No doctor notes" />
            </Section>

            <Section id="nurse-notes" icon="👩‍⚕️" title="Nursing Notes" sub="Categorised — every shift entry" count={nurseOther.length}>
              <NoteList notes={nurseOther} kind="nurse" emptyMsg="No nursing notes" />
            </Section>

            <Section id="orders" icon="💊" title="Orders + MAR" sub="Medications, IV, procedures — with admin trail" count={doctorOrders.length}>
              <OrdersSection orders={doctorOrders} />
            </Section>

            <Section id="vitals" icon="📈" title="Vital Trends" sub="Every vital recorded — both dedicated sheet + embedded in nursing notes">
              <VitalsSection vitals={vitals} nurseNotes={nurseNotes} />
            </Section>

            <Section id="investigations" icon="🧪" title="Investigations" sub="Lab + imaging orders with results" count={investigations.length}>
              <InvestigationSection investigations={investigations} />
            </Section>

            <Section id="consents" icon="📝" title="Consent Forms" sub="NABH PRE.3 / PRE.4 — every consent with full audit trail" count={consents.length}>
              <ConsentSection consents={consents} />
            </Section>

            <Section id="diet" icon="🥗" title="Dietician — Diet Plans" sub="Nutritional assessment + assigned diet plan with meal snapshot" count={dietPlans?.length || 0}>
              <DietPlansSection dietPlans={dietPlans} />
            </Section>

            <Section id="mlc" icon="⚖" title="Medico-Legal Cases" sub="MLC reports with FIR linkage" count={mlc.length}>
              <MLCSection mlc={mlc} />
            </Section>

            <Section id="handover" icon="🔄" title="Bed Transfers + Shift Handovers" sub="Every transfer of care">
              {(bedTransfers?.length || 0) === 0 && (shiftHandovers?.length || 0) === 0
                ? <Empty icon="🔄" msg="No handovers recorded" />
                : (
                  <>
                    {bedTransfers?.map((t) => (
                      <div key={t._id} className="pf-record">
                        <div className="pf-record__head">
                          <span className="pf-record__title">Bed transfer — {t.fromBed} → {t.toBed}</span>
                          <span className="pf-record__time">{fmtDT(t.createdAt)}</span>
                          <span className={`pf-badge pf-badge--${t.status === "Complete" ? "ok" : "warn"}`}>{t.status}</span>
                        </div>
                        <div className="pf-record__body">
                          {t.shiftingNotes  && <p><strong>Doctor notes:</strong> {t.shiftingNotes}</p>}
                          {t.handoverNotes  && <p><strong>Nurse handover:</strong> {t.handoverNotes}</p>}
                        </div>
                      </div>
                    ))}
                    {shiftHandovers?.map((h) => (
                      <div key={h._id} className="pf-record pf-record--nurse">
                        <div className="pf-record__head">
                          <span className="pf-record__title">Shift handover — {h.outgoingShift} → {h.incomingShift}</span>
                          <span className="pf-record__time">{fmtDT(h.createdAt)}</span>
                        </div>
                        <div className="pf-record__body">
                          {h.situation      && <p><strong>S:</strong> {h.situation}</p>}
                          {h.background     && <p><strong>B:</strong> {h.background}</p>}
                          {h.assessment     && <p><strong>A:</strong> {h.assessment}</p>}
                          {h.recommendation && <p><strong>R:</strong> {h.recommendation}</p>}
                        </div>
                      </div>
                    ))}
                  </>
                )
              }
            </Section>

            <Section id="discharge" icon="🏥" title="Discharge Summary" sub="NABH AAC.5 / COP.2">
              <DischargeSection dischargeSummary={dischargeSummary} />
            </Section>

            <Section id="billing" icon="💰" title="Billing Summary" sub="Bills + payments + TPA claims" count={bills.length}>
              <BillingSection bills={bills} />
            </Section>

            <Section id="activity" icon="🪵" title="Activity Log" sub="Every click, edit, dropdown selection — full UI audit feed" count={activityLog.length}>
              <ActivityFeed activityLog={activityLog} />
            </Section>

            <Section id="timeline" icon="📅" title="Unified Timeline" sub="Every record across every model, chronologically" count={timeline.length}>
              {timeline?.length ? (
                <div className="pf-timeline">
                  {timeline.slice(0, 300).map((t, i) => (
                    <div key={i} className="pf-timeline__item">
                      <div className="pf-timeline__dot" />
                      <div className="pf-timeline__time">{fmtDT(t.when)}</div>
                      <div className="pf-timeline__label">
                        {t.label}
                        <span className="pf-timeline__kind">{t.kind}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Empty msg="No timeline entries" />}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
