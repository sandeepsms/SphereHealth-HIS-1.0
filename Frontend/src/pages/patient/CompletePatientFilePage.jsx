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
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import useHospitalSettings from "../../Components/print/useHospitalSettings";
// R7fq Track D: shared SGRH/Max-style print shell for header/footer
// consistency across every printable in the HIS. The Patient File can
// span 8–15 pages — the shell's @page running header/footer + per-page
// terms keep every page self-identifying for NABH AAC.7 traceability.
// PrintLetterhead + PrintFooter (R7eo) are RETIRED in print mode because
// PrintShell now renders the canonical hospital header + footer; keeping
// both would double-stamp every page.
import PrintShell from "../../Components/print/PrintShell";
// R7ft: openPrint dispatches to /print/<slug> which delegates to the
// admin-picked patient-file theme (Narrative / Timeline / Executive /
// Audit / Editorial). Pre-R7ft the Print Complete File button opened
// THIS page in a popup with ?autoprint=1 → 18 pages of chip soup. The
// new path serves a 5-7-page themed printout via PrintShell + the
// canonical normalizeFileData() shape.
import { openPrint } from "../../Components/print/openPrint";
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
function IdentityBanner({ patient, currentAdmission, role, onBack, onPrint, onPrintReferral }) {
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
          {/* R7fv — Condensed handover for a referring physician. Same
              receipt payload as the Complete File; the renderer subsets
              it to first+last notes, latest MAR, consents, reports,
              transfusions and procedures (2–4 pages). */}
          <button
            className="pf-banner__btn pf-banner__btn--solid"
            style={{ marginLeft: 4 }}
            onClick={onPrintReferral}
            title="Condensed handover for a referring colleague (2–4 pages)"
          >
            🤝 Referral Summary
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── R7i: Re-activate Admission banner ───────────────────────────
   Admin-only emergency path for the case where a patient was just
   discharged but their condition deteriorated before they left.
   Hidden unless ALL of:
     • Current admission is "Discharged"
     • Discharge happened within the last 24h
     • Logged-in user is Admin
   Renders a prompt + Reason input + Re-activate button. On confirm,
   POSTs /api/admissions/:id/reactivate — the backend re-occupies
   the same bed atomically (or 409s if the bed was reassigned).
*/
function ReactivateBanner({ admission, viewerRole, onReactivated }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy]     = React.useState(false);
  const [error, setError]   = React.useState("");
  const [show, setShow]     = React.useState(false);

  if (viewerRole !== "Admin") return null;
  if (admission?.status !== "Discharged") return null;

  const dischargedAt =
    admission.actualDischargeDate
    || admission.dischargeWorkflow?.gatePassIssuedAt
    || admission.dischargeWorkflow?.billClearedAt
    || admission.dischargeWorkflow?.doctorApprovedAt;
  if (!dischargedAt) return null;
  const hoursSince = (Date.now() - new Date(dischargedAt).getTime()) / 3.6e6;
  if (hoursSince > 24) return null;

  const doReactivate = async () => {
    setError("");
    if (reason.trim().length < 10) {
      setError("Please describe why this discharge needs to be undone (min 10 chars).");
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.post(
        `${BASE}/admissions/${admission._id}/reactivate`,
        { reason: reason.trim() },
      );
      onReactivated?.(data);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Reactivation failed");
    } finally {
      setBusy(false);
    }
  };

  const styles = {
    wrap: {
      margin: "12px 0 16px",
      padding: 14,
      borderRadius: 10,
      border: "2px solid #f59e0b",
      background: "linear-gradient(135deg, #fff7ed, #fffbeb)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    },
    head: { display: "flex", alignItems: "center", gap: 10, fontWeight: 700, color: "#92400e" },
    sub:  { fontSize: 12.5, color: "#78350f" },
    row:  { display: "flex", gap: 10, alignItems: "stretch" },
    inp:  { flex: 1, padding: "8px 10px", border: "1.5px solid #fbbf24", borderRadius: 6, fontSize: 13, background: "white" },
    btn:  { padding: "8px 14px", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer", border: "none", color: "white", background: "#dc2626" },
    btnGhost: { padding: "8px 14px", borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer", border: "1.5px solid #fbbf24", color: "#92400e", background: "white" },
    err:  { color: "#b91c1c", fontSize: 12.5, fontWeight: 600 },
  };

  if (!show) {
    return (
      <div style={styles.wrap}>
        <div style={styles.head}>
          ⚠ Same-day discharge — Admin override available
        </div>
        <div style={styles.sub}>
          Discharged {Math.max(1, Math.round(hoursSince))}h ago. If the patient's condition deteriorated
          before leaving the premises, you can undo this discharge and put them back on the same bed
          without creating a new admission cycle. Audit-logged.
        </div>
        <div>
          <button style={styles.btnGhost} onClick={() => setShow(true)}>
            ↺ Re-activate this admission
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        ⚠ Confirm — undo discharge and re-activate admission
      </div>
      <div style={styles.sub}>
        This will flip status Active and re-occupy bed <b>{admission.bedNumber || "—"}</b>.
        Bills + notes already on file stay; the discharge workflow timestamps are cleared.
      </div>
      <div style={styles.row}>
        <input
          style={styles.inp}
          placeholder="Reason (e.g. patient collapsed in waiting area, BP dropped, etc.) — min 10 chars"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          autoFocus
        />
        <button style={styles.btnGhost} onClick={() => { setShow(false); setReason(""); setError(""); }} disabled={busy}>
          Cancel
        </button>
        <button style={styles.btn} onClick={doReactivate} disabled={busy}>
          {busy ? "Re-activating…" : "Confirm Re-activate"}
        </button>
      </div>
      {error && <div style={styles.err}>⚠ {error}</div>}
    </div>
  );
}

/* ── Pending-actions summary banner ──────────────────────────────
   Sits below the NABH completeness strip and answers "what's left
   to do RIGHT NOW for this patient?". Each pill scrolls the page
   to the relevant section on click. Only renders if there's at
   least one outstanding item — a fully-up-to-date file stays clean.
*/
function PendingActions({ data }) {
  const { doctorOrders = [], investigations = [], consents = [], dietPlans = [], currentAdmission } = data;

  // Doctor orders: anything not Completed / Stopped / Cancelled.
  const pendOrders = doctorOrders.filter((o) =>
    !["Completed", "Stopped", "Cancelled"].includes(o.status),
  ).length;

  // Investigations: tests whose result isn't in yet.
  let pendTests = 0;
  for (const inv of investigations) {
    for (const it of (inv.items || [])) {
      if (it.resultStatus !== "COMPLETED" && it.resultStatus !== "REPORTED") pendTests++;
    }
  }

  // Consents: not SIGNED (and not REFUSED/REVOKED, those are final).
  const pendConsents = consents.filter((c) =>
    !["SIGNED", "REFUSED", "REVOKED"].includes(c.status),
  ).length;

  // Initial Assessment gate: NABH requires Doctor AND Nurse IA before
  // any clinical work continues. Flag whichever is missing.
  const ia = currentAdmission?.initialAssessment || {};
  const iaDocNeeded   = !ia.doctorCompleted;
  const iaNurseNeeded = !ia.nurseCompleted;

  // Diet plan: a draft (or completely absent on an IPD admission) reads
  // as "no active plan yet".
  const pendDiet = dietPlans.filter((d) => d.status === "draft").length;

  const items = [];
  if (iaDocNeeded)   items.push({ id: "initial",        label: "Doctor IA pending",        icon: "🩺", color: "#7c3aed" });
  if (iaNurseNeeded) items.push({ id: "initial",        label: "Nursing IA pending",       icon: "👩‍⚕️", color: "#db2777" });
  if (pendOrders)    items.push({ id: "orders",         label: `${pendOrders} order${pendOrders!==1?"s":""} active / pending`, icon: "💊", color: "#ea580c" });
  if (pendTests)     items.push({ id: "investigations", label: `${pendTests} lab test${pendTests!==1?"s":""} awaiting result`, icon: "🧪", color: "#0284c7" });
  if (pendConsents)  items.push({ id: "consents",       label: `${pendConsents} consent${pendConsents!==1?"s":""} unsigned`, icon: "📝", color: "#ca8a04" });
  if (pendDiet)      items.push({ id: "diet",           label: `${pendDiet} diet plan draft`, icon: "🥗", color: "#16a34a" });

  if (!items.length) return null;

  return (
    <div style={{
      margin: "10px 0 14px", padding: "8px 12px",
      borderRadius: 8, background: "linear-gradient(180deg, #fffbeb 0%, #fff 100%)",
      border: "1px solid #fde68a", borderLeft: "4px solid #d97706",
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "#92400e", letterSpacing: 0.3 }}>
        ⏳ PENDING ACTIONS
      </span>
      {items.map((it, i) => (
        <button key={i} onClick={() => {
          const el = document.getElementById(it.id);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }} style={{
          padding: "3px 10px", borderRadius: 6, border: `1px solid ${it.color}40`,
          background: "#fff", color: it.color, fontSize: 11, fontWeight: 700,
          cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
        }}>
          <span style={{ fontSize: 12 }}>{it.icon}</span> {it.label}
        </button>
      ))}
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

/** Role-aware "+ Add new" CTA shown above section content.
 *  - viewerRole: the authenticated user's role
 *  - allow: array of roles that should see this CTA
 *  - href: target path; `{UHID}` token substituted, query-string preserved
 *  - color: button accent (matches the role's theme)
 *  - label: button text
 *  Renders nothing for any role not in `allow`. Opens in a new tab so the
 *  reader's place in the file is preserved while they author the new entry,
 *  matching the pattern set by DietPlansSection.
 */
function RoleAddCTA({ viewerRole, uhid, allow, href, color, label, icon = "+" }) {
  if (!uhid || !allow.includes(viewerRole)) return null;
  const url = href.replace("{UHID}", encodeURIComponent(uhid));
  return (
    <div style={{ margin: "0 0 10px", textAlign: "right" }}>
      <button onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        style={{
          padding: "5px 12px", borderRadius: 6,
          border: `1px solid ${color}40`,
          background: `${color}08`, color,
          fontSize: 11.5, fontWeight: 700, cursor: "pointer",
        }}>
        {icon} {label}
      </button>
    </div>
  );
}

/* ── Helpers for rendering "every populated field" on a clinical note ───
   Goal: when a doctor / nurse selects from a dropdown or writes anything
   into a structured form, the Patient File should reflect that — not just
   SOAP. These helpers walk the well-known nested objects and the catch-all
   Mixed payloads (DoctorNotes.noteDetails, NurseNotes.noteData,
   Admission.nurseInitialAssessment) and emit one row per populated leaf.
*/
const isMeaningful = (v) => {
  if (v == null || v === "" || v === false) return false;
  if (Array.isArray(v))      return v.length > 0;
  if (typeof v === "object") return Object.values(v).some(isMeaningful);
  return true;
};

const titleCase = (k) =>
  String(k || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

/* ── Clinical scoring scales ─────────────────────────────────────────
   When a Mixed payload contains keys that match a known scoring scale
   (Braden b1..b6, Morse m1..m6, MEWS, GCS, MUST), we render it as a
   dedicated panel so the bedside nurse / doctor sees:
       code · meaning · value · interpretation
   side-by-side, plus the total and the risk band — not just "b1: 3".

   Each scale's items map gives the human label + value→description
   table. interpret(total) returns the risk band + colour to render the
   total chip with.
*/
const SCORING_SCALES = {
  braden: {
    title: "Braden Scale — Pressure Ulcer Risk",
    accent: "#7c3aed",
    items: {
      b1: { label: "Sensory perception", values: { 1: "Completely limited", 2: "Very limited", 3: "Slightly limited", 4: "No impairment" } },
      b2: { label: "Moisture",          values: { 1: "Constantly moist", 2: "Very moist", 3: "Occasionally moist", 4: "Rarely moist" } },
      b3: { label: "Activity",          values: { 1: "Bedfast", 2: "Chairfast", 3: "Walks occasionally", 4: "Walks frequently" } },
      b4: { label: "Mobility",          values: { 1: "Completely immobile", 2: "Very limited", 3: "Slightly limited", 4: "No limitation" } },
      b5: { label: "Nutrition",         values: { 1: "Very poor", 2: "Probably inadequate", 3: "Adequate", 4: "Excellent" } },
      b6: { label: "Friction / shear",  values: { 1: "Problem", 2: "Potential problem", 3: "No apparent problem" } },
    },
    interpret(total) {
      if (total >= 19) return { risk: "Low risk (≥19)",       color: "#16a34a" };
      if (total >= 15) return { risk: "Mild risk (15–18)",    color: "#65a30d" };
      if (total >= 13) return { risk: "Moderate risk (13–14)", color: "#ca8a04" };
      if (total >= 10) return { risk: "High risk (10–12)",    color: "#ea580c" };
      return                 { risk: "Severe risk (≤9)",      color: "#dc2626" };
    },
  },
  morse: {
    title: "Morse Fall Scale",
    accent: "#db2777",
    items: {
      m1: { label: "History of falling (≤3 months)", values: { 0: "No", 25: "Yes" } },
      m2: { label: "Secondary diagnosis",            values: { 0: "No", 15: "Yes" } },
      m3: { label: "Ambulatory aid",                 values: { 0: "None / bedrest / w/c / nurse", 15: "Crutches / cane / walker", 30: "Furniture support" } },
      m4: { label: "IV / heparin lock",              values: { 0: "No", 20: "Yes" } },
      m5: { label: "Gait / transferring",            values: { 0: "Normal / bedrest / immobile", 10: "Weak", 20: "Impaired" } },
      m6: { label: "Mental status",                  values: { 0: "Oriented to own ability", 15: "Forgets / overestimates" } },
    },
    interpret(total) {
      if (total < 25) return { risk: "Low fall risk (<25)",    color: "#16a34a" };
      if (total < 45) return { risk: "Moderate (25–44)",       color: "#ca8a04" };
      return                { risk: "High fall risk (≥45)",    color: "#dc2626" };
    },
  },
  mews: {
    title: "MEWS — Modified Early Warning Score",
    accent: "#ea580c",
    items: {
      mews1: { label: "Respiratory rate" },
      mews2: { label: "Heart rate" },
      mews3: { label: "Systolic BP" },
      mews4: { label: "Temperature" },
      mews5: { label: "AVPU / consciousness" },
      mews6: { label: "Urine output" },
    },
    interpret(total) {
      if (total <= 2) return { risk: "Low concern",     color: "#16a34a" };
      if (total <= 4) return { risk: "Moderate (3–4)",  color: "#ca8a04" };
      return                { risk: "Critical (≥5)",   color: "#dc2626" };
    },
  },
  gcs: {
    title: "Glasgow Coma Scale",
    accent: "#0284c7",
    items: {
      eye:    { label: "Eye opening",        values: { 1: "None", 2: "To pain", 3: "To voice", 4: "Spontaneous" } },
      verbal: { label: "Verbal response",    values: { 1: "None", 2: "Incomprehensible", 3: "Inappropriate words", 4: "Confused", 5: "Oriented" } },
      motor:  { label: "Motor response",     values: { 1: "None", 2: "Extension to pain", 3: "Flexion to pain", 4: "Withdrawal", 5: "Localises pain", 6: "Obeys commands" } },
    },
    interpret(total) {
      if (total >= 13) return { risk: "Mild (13–15)",    color: "#16a34a" };
      if (total >=  9) return { risk: "Moderate (9–12)", color: "#ca8a04" };
      return                 { risk: "Severe (≤8)",      color: "#dc2626" };
    },
  },
};

/* ── Blood transfusion panel ─────────────────────────────────────────
   NABH safety-critical record. Storage shape (from NursingNotes):
       product, bagNo, crossMatchNo, volume, groupVerified, secondNurse,
       startTime, endTime, status, reactionType,
       preBP_sys/preBP_dia/prePulse/preTemp,
       postBP_sys/postBP_dia/postPulse
   Detect when ≥2 of these "blood-only" keys are present. Render with
   status + reaction big and colour-coded, and pre vs post vitals
   side-by-side so the safety story is one glance.
*/
const BLOOD_KEYS = new Set([
  "product", "bagno", "crossmatchno", "volume", "groupverified",
  "secondnurse", "starttime", "endtime", "status", "reactiontype",
  "prebp_sys", "prebp_dia", "prepulse", "pretemp",
  "postbp_sys", "postbp_dia", "postpulse",
]);
function matchBlood(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const keys = Object.keys(data).map((k) => k.toLowerCase());
  const hits = keys.filter((k) => BLOOD_KEYS.has(k)).length;
  // Strong signal: a bag number + a product, OR ≥3 distinct blood keys.
  return (hits >= 3) || (keys.includes("bagno") && keys.includes("product"));
}
function lc(data, key) {
  if (!data) return undefined;
  for (const k of Object.keys(data)) if (k.toLowerCase() === key.toLowerCase()) return data[k];
  return undefined;
}
function BloodTransfusionPanel({ data }) {
  const product       = lc(data, "product");
  const bagNo         = lc(data, "bagNo");
  const crossMatchNo  = lc(data, "crossMatchNo");
  const volume        = lc(data, "volume");
  const groupVerified = lc(data, "groupVerified");
  const secondNurse   = lc(data, "secondNurse");
  const startTime     = lc(data, "startTime");
  const endTime       = lc(data, "endTime");
  const status        = lc(data, "status");
  const reactionType  = lc(data, "reactionType");

  const statusColor   = status === "Completed"  ? "#16a34a"
                      : status === "Transfusing" ? "#ca8a04"
                      : status === "Stopped"    ? "#dc2626"
                      : "#64748b";
  const reactionColor = reactionType && reactionType !== "None" ? "#dc2626" : "#16a34a";

  const preVitals = [
    (lc(data, "preBP_sys") || lc(data, "preBP_dia")) && `BP ${lc(data, "preBP_sys") ?? "?"}/${lc(data, "preBP_dia") ?? "?"}`,
    lc(data, "prePulse") && `Pulse ${lc(data, "prePulse")}`,
    lc(data, "preTemp")  && `Temp ${lc(data, "preTemp")}°F`,
  ].filter(Boolean).join("  ·  ");
  const postVitals = [
    (lc(data, "postBP_sys") || lc(data, "postBP_dia")) && `BP ${lc(data, "postBP_sys") ?? "?"}/${lc(data, "postBP_dia") ?? "?"}`,
    lc(data, "postPulse") && `Pulse ${lc(data, "postPulse")}`,
  ].filter(Boolean).join("  ·  ");

  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #fef2f2 0%, #fff 30%)",
      border: "1px solid #fecaca", borderLeft: "4px solid #dc2626",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#b91c1c", letterSpacing: 0.4 }}>🩸 BLOOD TRANSFUSION</span>
        {status && (
          <span style={{
            padding: "2px 9px", borderRadius: 4, fontSize: 11, fontWeight: 800,
            background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}50`,
          }}>{status.toUpperCase()}</span>
        )}
        {reactionType && (
          <span style={{
            padding: "2px 9px", borderRadius: 4, fontSize: 11, fontWeight: 800,
            background: `${reactionColor}18`, color: reactionColor, border: `1px solid ${reactionColor}50`,
          }}>REACTION: {reactionType.toUpperCase()}</span>
        )}
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: "3px 14px", fontSize: 11.5, marginBottom: 6,
      }}>
        {product       && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Product:</span> <b>{product}</b></div>}
        {bagNo         && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Bag #:</span> <span style={{ fontFamily: "monospace" }}>{bagNo}</span></div>}
        {crossMatchNo  && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>X-Match:</span> <span style={{ fontFamily: "monospace" }}>{crossMatchNo}</span></div>}
        {volume        && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Volume:</span> {volume} ml</div>}
        {startTime     && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Start:</span> {startTime}</div>}
        {endTime       && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>End:</span> {endTime}</div>}
        {secondNurse   && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>2nd Nurse:</span> {secondNurse}</div>}
        {groupVerified !== undefined && groupVerified !== "" && (
          <div>
            <span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Group verified:</span>{" "}
            <span style={{ color: groupVerified ? "#16a34a" : "#dc2626", fontWeight: 800 }}>
              {groupVerified ? "✓ Yes" : "✗ No"}
            </span>
          </div>
        )}
      </div>

      {(() => {
        // Stitch together every vitals reading the form captured, in time
        // order: PRE → in-transfusion monitoring entries (15 min, 30 min,
        // 60 min, …) → POST. Each entry shows the time label + BP/Pulse/Temp.
        const rows = [];
        if (preVitals) rows.push({ label: "PRE", vitals: preVitals });

        // Modern shape: noteData.intra = [{ atMin, bp_sys, bp_dia, pulse, temp }, …]
        // Legacy shape: noteData.monitoring = same
        // Fallback: explicit mon15_*, mon30_*, mon60_* keys
        const intraArr = lc(data, "intra") || lc(data, "monitoring") || [];
        if (Array.isArray(intraArr)) {
          for (const row of intraArr) {
            if (!row || typeof row !== "object") continue;
            const parts = [
              (row.bp_sys || row.bp_dia) && `BP ${row.bp_sys ?? "?"}/${row.bp_dia ?? "?"}`,
              row.pulse && `Pulse ${row.pulse}`,
              row.temp  && `Temp ${row.temp}°F`,
              row.spo2  && `SpO2 ${row.spo2}%`,
            ].filter(Boolean);
            if (!parts.length) continue;
            const min = row.atMin ?? row.at ?? row.minute ?? row.t;
            rows.push({
              label: min != null ? `+${min} min` : (row.label || "Intra"),
              vitals: parts.join("  ·  "),
            });
          }
        }
        // Loose-key fallback: any mon15_BP_sys / mon30_Pulse / etc.
        const looseTimes = new Set();
        for (const k of Object.keys(data)) {
          const m = k.match(/^mon(\d+)_/i);
          if (m) looseTimes.add(Number(m[1]));
        }
        for (const t of [...looseTimes].sort((a, b) => a - b)) {
          const bp_s = lc(data, `mon${t}_BP_sys`);
          const bp_d = lc(data, `mon${t}_BP_dia`);
          const p    = lc(data, `mon${t}_Pulse`);
          const tem  = lc(data, `mon${t}_Temp`);
          const parts = [
            (bp_s || bp_d) && `BP ${bp_s ?? "?"}/${bp_d ?? "?"}`,
            p && `Pulse ${p}`,
            tem && `Temp ${tem}°F`,
          ].filter(Boolean);
          if (parts.length) rows.push({ label: `+${t} min`, vitals: parts.join("  ·  ") });
        }

        if (postVitals) rows.push({ label: "POST", vitals: postVitals });
        if (!rows.length) return null;

        return (
          <div style={{
            display: "grid", gridTemplateColumns: "70px 1fr", gap: "2px 8px",
            fontSize: 11, padding: "6px 8px", background: "#fff",
            borderRadius: 4, border: "1px dashed #fecaca",
          }}>
            {rows.map((r, i) => (
              <React.Fragment key={i}>
                <span style={{ fontWeight: 800, color: "#b91c1c" }}>{r.label}</span>
                <span style={{ fontFamily: "monospace" }}>{r.vitals}</span>
              </React.Fragment>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

/* ── Generic detector helper ─────────────────────────────────────────
   `matchKeys(data, keys, min)` returns true iff `data` is an object
   that contains at least `min` of the given keys (case-insensitive).
   Used by the type-specific match*() functions below. */
function matchKeys(data, keys, min = 3) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const have = new Set(Object.keys(data).map((k) => k.toLowerCase()));
  let hits = 0;
  for (const k of keys) if (have.has(k.toLowerCase())) hits++;
  return hits >= min;
}

/* ── IV LINE / INFUSION ─────────────────────────────────────────── */
function matchIV(data) {
  if (!matchKeys(data, ["fluid", "volume", "rate", "dropsPerMin", "route", "site", "cannulaDate", "setChangeDate", "additive"], 3)) return false;
  // Disambiguate from blood — blood has product+bagNo.
  if (lc(data, "bagNo") && lc(data, "product")) return false;
  return true;
}
function IVPanel({ data }) {
  const site = lc(data, "site");
  const cond = lc(data, "condition");
  const siteColor = (cond || "").toLowerCase().includes("patent") ? "#16a34a"
                  : (cond || "").toLowerCase().match(/swollen|redness|removed/) ? "#dc2626"
                  : "#64748b";
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #ecfeff 0%, #fff 30%)",
      border: "1px solid #a5f3fc", borderLeft: "4px solid #0891b2",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0e7490", letterSpacing: 0.3 }}>💧 IV LINE / INFUSION</span>
        {cond && (
          <span style={{ padding: "2px 9px", borderRadius: 4, fontSize: 10.5, fontWeight: 800,
            background: `${siteColor}18`, color: siteColor, border: `1px solid ${siteColor}50` }}>{cond.toUpperCase()}</span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "3px 14px", fontSize: 11.5 }}>
        {lc(data, "fluid")         && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Fluid:</span> <b>{lc(data, "fluid")}</b></div>}
        {lc(data, "volume")        && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Volume:</span> {lc(data, "volume")} ml</div>}
        {lc(data, "rate")          && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Rate:</span> {lc(data, "rate")} ml/h</div>}
        {lc(data, "dropsPerMin")   && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Drops/min:</span> {lc(data, "dropsPerMin")}</div>}
        {lc(data, "route")         && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Route:</span> {lc(data, "route")}</div>}
        {site                       && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Site:</span> {site}</div>}
        {lc(data, "cannulaDate")   && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Cannula:</span> {lc(data, "cannulaDate")}</div>}
        {lc(data, "setChangeDate") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Set change:</span> {lc(data, "setChangeDate")}</div>}
        {lc(data, "additive")      && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Additive:</span> {lc(data, "additive")}</div>}
      </div>
    </div>
  );
}

/* ── WOUND CARE ─────────────────────────────────────────────────── */
function matchWound(data) {
  return matchKeys(data, ["exudateAmt", "exudateType", "healingStage", "tunneling", "undermining", "surroundingSkin", "dressing", "type"], 3)
      && (lc(data, "exudateAmt") || lc(data, "exudateType") || lc(data, "healingStage"));
}
function WoundPanel({ data }) {
  const stage = lc(data, "healingStage") || "";
  const stageColor = /granulating|epithelial/i.test(stage) ? "#16a34a"
                   : /sloughy|necrotic|infected/i.test(stage) ? "#dc2626"
                   : "#ca8a04";
  const L = lc(data, "length"), W = lc(data, "width"), D = lc(data, "depth");
  const dims = [L && `${L} cm`, W && `${W} cm`, D && `${D} cm`].filter(Boolean).join(" × ");
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #fff7ed 0%, #fff 30%)",
      border: "1px solid #fed7aa", borderLeft: "4px solid #ea580c",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#9a3412" }}>🩹 WOUND CARE</span>
        {stage && (
          <span style={{ padding: "2px 9px", borderRadius: 4, fontSize: 10.5, fontWeight: 800,
            background: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}50` }}>{stage.toUpperCase()}</span>
        )}
        {lc(data, "tunneling")    && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fee2e2", color: "#b91c1c" }}>⚠ Tunneling</span>}
        {lc(data, "undermining")  && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fee2e2", color: "#b91c1c" }}>⚠ Undermining</span>}
        {lc(data, "odour")        && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fee2e2", color: "#b91c1c" }}>⚠ Odour</span>}
        {lc(data, "swabSent")     && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#dcfce7", color: "#166534" }}>Swab sent</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "3px 14px", fontSize: 11.5 }}>
        {lc(data, "type")          && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Type:</span> <b>{lc(data, "type")}</b></div>}
        {lc(data, "site")          && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Site:</span> {lc(data, "site")}</div>}
        {dims                      && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>L × W × D:</span> <span style={{ fontFamily: "monospace" }}>{dims}</span></div>}
        {(lc(data, "exudateAmt") || lc(data, "exudateType")) && (
          <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Exudate:</span> {[lc(data, "exudateAmt"), lc(data, "exudateType")].filter(Boolean).join(" · ")}</div>
        )}
        {lc(data, "surroundingSkin") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Surrounding:</span> {lc(data, "surroundingSkin")}</div>}
        {lc(data, "dressing")      && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Dressing:</span> {lc(data, "dressing")}</div>}
        {lc(data, "painDuring")    && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Pain during:</span> {lc(data, "painDuring")}</div>}
        {lc(data, "nextDressingDate") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Next dressing:</span> {lc(data, "nextDressingDate")}</div>}
      </div>
    </div>
  );
}

/* ── PAIN ASSESSMENT ────────────────────────────────────────────── */
function matchPain(data) {
  if (!matchKeys(data, ["scale", "score", "location", "character", "onset", "duration", "frequency", "aggravating", "relieving", "analgesicGiven", "reassessScore"], 3)) return false;
  return lc(data, "score") != null || lc(data, "reassessScore") != null;
}
function PainPanel({ data }) {
  const score = Number(lc(data, "score"));
  const scoreColor = !Number.isFinite(score) ? "#64748b"
                   : score >= 7 ? "#dc2626"
                   : score >= 4 ? "#ea580c"
                   : score >= 1 ? "#ca8a04"
                   : "#16a34a";
  const reScore = Number(lc(data, "reassessScore"));
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #fdf2f8 0%, #fff 30%)",
      border: "1px solid #fbcfe8", borderLeft: "4px solid #db2777",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#9d174d" }}>🔥 PAIN ASSESSMENT</span>
        {Number.isFinite(score) && (
          <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: 12, fontWeight: 800,
            background: `${scoreColor}18`, color: scoreColor, border: `1px solid ${scoreColor}50` }}>
            {score}/10 {lc(data, "scale") || ""}
          </span>
        )}
        {Number.isFinite(reScore) && (
          <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700,
            background: "#fff", color: scoreColor, border: `1px dashed ${scoreColor}` }}>
            Reassess: {reScore}/10 {lc(data, "reassessTime") ? `@ ${lc(data, "reassessTime")}` : ""}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "3px 14px", fontSize: 11.5 }}>
        {lc(data, "location")     && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Location:</span> <b>{lc(data, "location")}</b></div>}
        {lc(data, "type")         && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Type:</span> {lc(data, "type")}</div>}
        {lc(data, "character")    && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Character:</span> {lc(data, "character")}</div>}
        {lc(data, "onset")        && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Onset:</span> {lc(data, "onset")}</div>}
        {lc(data, "duration")     && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Duration:</span> {lc(data, "duration")}</div>}
        {lc(data, "frequency")    && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Frequency:</span> {lc(data, "frequency")}</div>}
        {lc(data, "radiation")    && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Radiation:</span> Yes{lc(data, "radiationSite") ? ` → ${lc(data, "radiationSite")}` : ""}</div>}
        {lc(data, "aggravating")  && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Aggravating:</span> {lc(data, "aggravating")}</div>}
        {lc(data, "relieving")    && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Relieving:</span> {lc(data, "relieving")}</div>}
        {lc(data, "painOnMovement") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>On movement:</span> Yes</div>}
        {lc(data, "nonPharm")     && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Non-pharm:</span> {lc(data, "nonPharm")}</div>}
        {(lc(data, "analgesicGiven") || lc(data, "analgesic")) && (
          <div style={{ gridColumn: "1 / -1", paddingTop: 4, borderTop: "1px dashed #fbcfe8" }}>
            <span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Analgesic:</span>{" "}
            <b>{lc(data, "analgesic") || "Given"}</b>
            {lc(data, "analgesicRoute") ? ` · ${lc(data, "analgesicRoute")}` : ""}
            {lc(data, "analgesicTime")  ? ` @ ${lc(data, "analgesicTime")}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── NEURO ASSESSMENT ───────────────────────────────────────────── */
function matchNeuro(data) {
  // GCS sub-scores are the strong signal; pupils/limbs alone aren't enough.
  return matchKeys(data, ["gcse", "gcsv", "gcsm", "pupils", "pupilSizeL", "pupilSizeR", "lightReflex", "seizure", "orientation", "limbUL", "limbUR", "limbLL", "limbLR"], 3);
}
function NeuroPanel({ data }) {
  const e = Number(lc(data, "gcse")), v = Number(lc(data, "gcsv")), m = Number(lc(data, "gcsm"));
  const gcsTotal = Number.isFinite(e) && Number.isFinite(v) && Number.isFinite(m) ? e + v + m : null;
  const gcsColor = gcsTotal == null ? "#64748b"
                 : gcsTotal >= 13 ? "#16a34a"
                 : gcsTotal >=  9 ? "#ca8a04"
                 : "#dc2626";
  const limbs = {
    UL: lc(data, "limbUL"), UR: lc(data, "limbUR"),
    LL: lc(data, "limbLL"), LR: lc(data, "limbLR"),
  };
  const hasLimbs = Object.values(limbs).some((x) => x);
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #f5f3ff 0%, #fff 30%)",
      border: "1px solid #ddd6fe", borderLeft: "4px solid #7c3aed",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#5b21b6" }}>🧠 NEURO ASSESSMENT</span>
        {gcsTotal != null && (
          <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: 12, fontWeight: 800,
            background: `${gcsColor}18`, color: gcsColor, border: `1px solid ${gcsColor}50` }}>
            GCS {gcsTotal}/15 (E{e}V{v}M{m})
          </span>
        )}
        {lc(data, "seizure") && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fee2e2", color: "#b91c1c" }}>⚠ Seizure</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "3px 14px", fontSize: 11.5, marginBottom: hasLimbs ? 6 : 0 }}>
        {lc(data, "orientation")  && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Orientation:</span> <b>{lc(data, "orientation")}</b></div>}
        {lc(data, "pupils")       && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Pupils:</span> {lc(data, "pupils")}</div>}
        {(lc(data, "pupilSizeL") || lc(data, "pupilSizeR")) && (
          <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Size L/R:</span> {lc(data, "pupilSizeL") || "?"} / {lc(data, "pupilSizeR") || "?"} mm</div>
        )}
        {lc(data, "lightReflex")  && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Light reflex:</span> {lc(data, "lightReflex")}</div>}
      </div>
      {hasLimbs && (
        <div style={{ padding: "6px 8px", background: "#fff", borderRadius: 4, border: "1px dashed #ddd6fe" }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#6d28d9", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>LIMB POWER</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px", fontSize: 11, fontFamily: "monospace" }}>
            <div><b>UL:</b> {limbs.UL || "—"}</div>
            <div><b>UR:</b> {limbs.UR || "—"}</div>
            <div><b>LL:</b> {limbs.LL || "—"}</div>
            <div><b>LR:</b> {limbs.LR || "—"}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── PROCEDURE NOTE ─────────────────────────────────────────────── */
function matchProcedure(data) {
  return (lc(data, "procedureName") || "") !== "" && matchKeys(data, ["procedureName", "indication", "site", "performedBy", "outcome", "complications", "consentObtained", "sterile"], 3);
}
function ProcedurePanel({ data }) {
  const outcome = lc(data, "outcome") || "";
  const outColor = /well|success/i.test(outcome) ? "#16a34a"
                 : /complic|fail|abort/i.test(outcome) ? "#dc2626"
                 : "#ca8a04";
  const complications = lc(data, "complications");
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #f0fdf4 0%, #fff 30%)",
      border: "1px solid #bbf7d0", borderLeft: "4px solid #16a34a",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#166534" }}>🩺 PROCEDURE</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>{lc(data, "procedureName")}</span>
        {outcome && (
          <span style={{ padding: "2px 9px", borderRadius: 4, fontSize: 10.5, fontWeight: 800,
            background: `${outColor}18`, color: outColor, border: `1px solid ${outColor}50` }}>{outcome.toUpperCase()}</span>
        )}
        {lc(data, "consentObtained") && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#dcfce7", color: "#166534" }}>Consent ✓</span>}
        {lc(data, "sterile")         && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#dcfce7", color: "#166534" }}>Sterile</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "3px 14px", fontSize: 11.5 }}>
        {lc(data, "indication")    && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Indication:</span> {lc(data, "indication")}</div>}
        {lc(data, "site")          && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Site:</span> {lc(data, "site")}{lc(data, "laterality") && lc(data, "laterality") !== "N/A" ? ` (${lc(data, "laterality")})` : ""}</div>}
        {lc(data, "time")          && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Time:</span> {lc(data, "time")}</div>}
        {lc(data, "performedBy")   && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>By:</span> {lc(data, "performedBy")}{lc(data, "designation") ? ` · ${lc(data, "designation")}` : ""}</div>}
        {lc(data, "assistant")     && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Assistant:</span> {lc(data, "assistant")}</div>}
        {lc(data, "position")      && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Position:</span> {lc(data, "position")}</div>}
        {complications && complications !== "None" && (
          <div style={{ gridColumn: "1 / -1", padding: 4, background: "#fee2e2", borderRadius: 4, color: "#991b1b" }}>
            <b>⚠ Complications:</b> {complications}
          </div>
        )}
        {lc(data, "specimenSent")  && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Specimen sent:</span> Yes{lc(data, "specimenType") ? ` · ${lc(data, "specimenType")}` : ""}</div>}
        {lc(data, "postProcVitals")&& <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Post-proc vitals:</span> {lc(data, "postProcVitals")}</div>}
        {lc(data, "followUp")      && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Follow-up:</span> {lc(data, "followUp")}</div>}
      </div>
    </div>
  );
}

/* ── VITAL SHEET / STANDALONE VITALS NOTE ──────────────────────── */
function matchVitals(data) {
  // Strong signature: BP fields + at least one other vital. Don't trigger
  // on the inline `vitals` sub-object that lives on every note — that's
  // already rendered by VitalsInline. Only match a flat top-level note
  // that exists to record vitals.
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const have = new Set(Object.keys(data).map((k) => k.toLowerCase()));
  if (!(have.has("bp_sys") || have.has("bp_dia"))) return false;
  // Require ≥2 of: pulse / temp / spo2 / rr / gcs / bsl / painScore / o2Device
  let other = 0;
  for (const k of ["pulse", "temp", "spo2", "rr", "gcs", "bsl", "painscore", "o2flow", "o2device", "position", "weight"]) {
    if (have.has(k)) other++;
  }
  return other >= 2;
}
function VitalsPanel({ data }) {
  const bp_s = lc(data, "bp_sys"), bp_d = lc(data, "bp_dia");
  const pulse = lc(data, "pulse"), temp = lc(data, "temp"), spo2 = lc(data, "spo2"), rr = lc(data, "rr");
  const gcs = lc(data, "gcs"), bsl = lc(data, "bsl"), pain = lc(data, "painScore");
  const o2Flow = lc(data, "o2Flow"), o2Dev = lc(data, "o2Device");
  // Quick triage: critical vital flags
  const flags = [];
  const p = Number(pulse); if (Number.isFinite(p) && (p < 50 || p > 120)) flags.push({ k: "Pulse", v: p });
  const sysN = Number(bp_s); if (Number.isFinite(sysN) && (sysN < 90 || sysN > 180)) flags.push({ k: "Sys BP", v: sysN });
  const spoN = Number(spo2); if (Number.isFinite(spoN) && spoN < 92) flags.push({ k: "SpO₂", v: spoN });
  const rrN  = Number(rr);   if (Number.isFinite(rrN)  && (rrN < 10 || rrN > 24)) flags.push({ k: "RR", v: rrN });
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #eff6ff 0%, #fff 30%)",
      border: "1px solid #bfdbfe", borderLeft: "4px solid #2563eb",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#1d4ed8" }}>📊 VITALS</span>
        {flags.map((f, i) => (
          <span key={i} style={{ padding: "1px 8px", borderRadius: 4, fontSize: 10.5, fontWeight: 800,
            background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5" }}>⚠ {f.k}: {f.v}</span>
        ))}
        {lc(data, "position") && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#dbeafe", color: "#1e40af" }}>{lc(data, "position")}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "3px 14px", fontSize: 11.5, fontFamily: "monospace" }}>
        {(bp_s || bp_d) && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>BP:</span> <b>{bp_s ?? "?"}/{bp_d ?? "?"}</b> mmHg</div>}
        {pulse  != null && pulse  !== "" && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>Pulse:</span> <b>{pulse}</b>/min</div>}
        {temp   != null && temp   !== "" && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>Temp:</span> <b>{temp}</b>°F</div>}
        {rr     != null && rr     !== "" && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>RR:</span> <b>{rr}</b>/min</div>}
        {spo2   != null && spo2   !== "" && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>SpO₂:</span> <b>{spo2}</b>%</div>}
        {gcs    != null && gcs    !== "" && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>GCS:</span> <b>{gcs}</b>/15</div>}
        {bsl    != null && bsl    !== "" && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>BSL:</span> <b>{bsl}</b> mg/dL</div>}
        {pain   != null && pain   !== "" && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>Pain:</span> <b>{pain}</b>/10</div>}
        {lc(data, "weight") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>Weight:</span> {lc(data, "weight")} kg</div>}
        {(o2Flow || (o2Dev && o2Dev !== "None")) && (
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: "var(--pf-muted)", fontWeight: 700, fontFamily: "system-ui" }}>O₂:</span> <b>{o2Flow || ""}</b>{o2Flow && o2Dev ? " L/min · " : ""}{o2Dev || ""}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── INTAKE / OUTPUT ────────────────────────────────────────────── */
function matchIO(data) {
  if (!matchKeys(data, ["oral", "ivFluids", "bloodProducts", "urineOutput", "drainOutput", "nasogastric", "emesis", "bloodLoss"], 2)) return false;
  // Disambiguate from IV (which has `fluid` not `ivFluids`).
  if (lc(data, "fluid") && lc(data, "rate")) return false;
  return true;
}
function IOPanel({ data }) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const oral = num(lc(data, "oral"));
  const ivF  = num(lc(data, "ivFluids"));
  const blP  = num(lc(data, "bloodProducts"));
  const urn  = num(lc(data, "urineOutput"));
  const drn  = num(lc(data, "drainOutput"));
  const ngt  = num(lc(data, "nasogastric"));
  const eme  = num(lc(data, "emesis"));
  const bld  = num(lc(data, "bloodLoss"));
  const totalIn  = oral + ivF + blP;
  const totalOut = urn + drn + ngt + eme + bld;
  const net = totalIn - totalOut;
  const netColor = net > 500 ? "#ca8a04" : net < -500 ? "#dc2626" : "#16a34a";
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #ecfdf5 0%, #fff 30%)",
      border: "1px solid #a7f3d0", borderLeft: "4px solid #0d9488",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f766e" }}>💧 INTAKE / OUTPUT</span>
        <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 800,
          background: `${netColor}18`, color: netColor, border: `1px solid ${netColor}50` }}>
          Net: {net >= 0 ? "+" : ""}{net} ml
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 11.5 }}>
        <div style={{ padding: "6px 8px", background: "#f0fdf4", borderRadius: 4, border: "1px dashed #86efac" }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>INTAKE ({totalIn} ml)</div>
          {oral > 0 && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Oral:</span> {oral} ml</div>}
          {ivF  > 0 && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>IV fluids:</span> {ivF} ml</div>}
          {blP  > 0 && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Blood prod.:</span> {blP} ml</div>}
        </div>
        <div style={{ padding: "6px 8px", background: "#fef2f2", borderRadius: 4, border: "1px dashed #fca5a5" }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#b91c1c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>OUTPUT ({totalOut} ml)</div>
          {urn > 0 && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Urine:</span> {urn} ml</div>}
          {drn > 0 && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Drain:</span> {drn} ml</div>}
          {ngt > 0 && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>NGT:</span> {ngt} ml</div>}
          {eme > 0 && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Emesis:</span> {eme} ml</div>}
          {bld > 0 && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Blood loss:</span> {bld} ml</div>}
        </div>
      </div>
      {lc(data, "notes") && <div style={{ marginTop: 4, fontSize: 11, color: "var(--pf-muted)", fontStyle: "italic" }}>{lc(data, "notes")}</div>}
    </div>
  );
}

/* ── DAILY ASSESSMENT ───────────────────────────────────────────── */
function matchDaily(data) {
  return matchKeys(data, ["neuroStatus", "respiratoryStatus", "cardiovascularStatus", "giStatus", "guStatus", "musculoskeletalStatus", "skinStatus"], 3);
}
function DailyAssessmentPanel({ data }) {
  const systems = [
    ["Neuro",  lc(data, "neuroStatus")],
    ["Resp",   lc(data, "respiratoryStatus")],
    ["CVS",    lc(data, "cardiovascularStatus")],
    ["GI",     lc(data, "giStatus")],
    ["GU",     lc(data, "guStatus")],
    ["MSK",    lc(data, "musculoskeletalStatus")],
    ["Skin",   lc(data, "skinStatus")],
  ].filter(([, v]) => v);
  const intvs = Object.entries(data)
    .filter(([k, v]) => k.startsWith("int") && v === true)
    .map(([k]) => titleCase(k.replace(/^int/, "")));
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #fefce8 0%, #fff 30%)",
      border: "1px solid #fde68a", borderLeft: "4px solid #ca8a04",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#a16207" }}>📅 DAILY ASSESSMENT</span>
      </div>
      {systems.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#a16207", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>SYSTEM-WISE STATUS</div>
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: "2px 8px", fontSize: 11, paddingLeft: 8, borderLeft: "2px solid #fde68a" }}>
            {systems.map(([label, val]) => (
              <React.Fragment key={label}>
                <span style={{ fontWeight: 700, color: "#a16207" }}>{label}</span>
                <span>{val}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
      {intvs.length > 0 && (
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#a16207", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>INTERVENTIONS DONE ({intvs.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {intvs.map((t) => (
              <span key={t} style={{
                padding: "1px 7px", borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                background: "#fff", color: "#a16207", border: "1px solid #fde68a",
              }}>✓ {t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── NUTRITION ASSESSMENT ───────────────────────────────────────── */
function matchNutrition(data) {
  return matchKeys(data, ["bmi", "nutritionScore", "diseaseScore", "dietType", "feedingMode", "appetite", "swallowing", "caloriesToday", "proteinToday", "dietitianReferral"], 3);
}
function NutritionPanel({ data }) {
  // MUST screening total: bmiLow(0/1/2) + weightLoss(0/1/2) + reducedIntake(0/1/2) + seriouslyIll(0/2)
  const must = (v) => { const n = Number(v); return Number.isFinite(n) ? n : (v === true ? 2 : 0); };
  const mustTotal = must(lc(data, "bmiLow")) + must(lc(data, "weightLoss")) + must(lc(data, "reducedIntake")) + must(lc(data, "seriouslyIll"));
  const mustBand = mustTotal === 0 ? { l: "Low risk", c: "#16a34a" }
                 : mustTotal === 1 ? { l: "Medium risk", c: "#ca8a04" }
                 :                    { l: "High risk", c: "#dc2626" };
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #f0fdfa 0%, #fff 30%)",
      border: "1px solid #99f6e4", borderLeft: "4px solid #0d9488",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f766e" }}>🥗 NUTRITION</span>
        {(lc(data, "bmi") || mustTotal > 0) && (
          <span style={{ padding: "2px 9px", borderRadius: 4, fontSize: 11, fontWeight: 800,
            background: `${mustBand.c}18`, color: mustBand.c, border: `1px solid ${mustBand.c}50` }}>
            MUST {mustTotal} · {mustBand.l}
          </span>
        )}
        {lc(data, "dietitianReferral") && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e" }}>📨 Dietitian referral</span>}
        {lc(data, "fluidRestriction") && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#dbeafe", color: "#1e40af" }}>💧 Fluid restricted</span>}
        {lc(data, "ngtPresent") && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e" }}>NGT</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "3px 14px", fontSize: 11.5 }}>
        {lc(data, "bmi")     && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>BMI:</span> <b>{lc(data, "bmi")}</b></div>}
        {lc(data, "weight")  && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Weight:</span> {lc(data, "weight")} kg</div>}
        {lc(data, "height")  && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Height:</span> {lc(data, "height")} cm</div>}
        {lc(data, "midArmCirc") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>MAC:</span> {lc(data, "midArmCirc")} cm</div>}
        {lc(data, "dietType") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Diet:</span> <b>{lc(data, "dietType")}</b></div>}
        {lc(data, "consistency") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Consistency:</span> {lc(data, "consistency")}</div>}
        {lc(data, "appetite") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Appetite:</span> {lc(data, "appetite")}</div>}
        {lc(data, "swallowing") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Swallowing:</span> {lc(data, "swallowing")}</div>}
        {lc(data, "feedingMode") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Feeding:</span> {lc(data, "feedingMode")}</div>}
        {lc(data, "fluidLimit") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Fluid limit:</span> {lc(data, "fluidLimit")} ml/d</div>}
      </div>
      {(lc(data, "caloriesToday") || lc(data, "proteinToday") || lc(data, "fluidToday")) && (
        <div style={{ marginTop: 6, padding: "4px 8px", background: "#fff", borderRadius: 4, border: "1px dashed #99f6e4", fontSize: 11, display: "flex", gap: 16, flexWrap: "wrap", fontFamily: "monospace" }}>
          <span style={{ color: "#0f766e", fontWeight: 800, fontFamily: "system-ui" }}>TODAY:</span>
          {lc(data, "caloriesToday") && <span><b>{lc(data, "caloriesToday")}</b> kcal</span>}
          {lc(data, "proteinToday")  && <span><b>{lc(data, "proteinToday")}</b> g protein</span>}
          {lc(data, "fluidToday")    && <span><b>{lc(data, "fluidToday")}</b> ml fluid</span>}
        </div>
      )}
      {lc(data, "referralReason") && (
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--pf-muted)" }}><b>Referral reason:</b> {lc(data, "referralReason")}</div>
      )}
    </div>
  );
}

/* ── PATIENT EDUCATION ──────────────────────────────────────────── */
function matchEducation(data) {
  return matchKeys(data, ["educator", "topics", "methods", "language", "understanding", "barriers", "response", "sessionNotes", "nextSessionDate"], 3);
}
function EducationPanel({ data }) {
  const understanding = lc(data, "understanding") || "";
  const undColor = /excellent|good/i.test(understanding) ? "#16a34a"
                 : /fair|partial/i.test(understanding) ? "#ca8a04"
                 : /poor|none/i.test(understanding) ? "#dc2626"
                 : "#64748b";
  const arr = (v) => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #faf5ff 0%, #fff 30%)",
      border: "1px solid #e9d5ff", borderLeft: "4px solid #9333ea",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#6b21a8" }}>📚 PATIENT EDUCATION</span>
        {understanding && (
          <span style={{ padding: "2px 9px", borderRadius: 4, fontSize: 10.5, fontWeight: 800,
            background: `${undColor}18`, color: undColor, border: `1px solid ${undColor}50` }}>
            {understanding.toUpperCase()} UNDERSTANDING
          </span>
        )}
        {lc(data, "response") && (
          <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#f3e8ff", color: "#6b21a8" }}>{lc(data, "response")}</span>
        )}
        {lc(data, "language") && <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fff", color: "#6b21a8", border: "1px solid #e9d5ff" }}>{lc(data, "language")}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "3px 14px", fontSize: 11.5, marginBottom: 6 }}>
        {lc(data, "date")     && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Date:</span> {lc(data, "date")}</div>}
        {lc(data, "educator") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Educator:</span> <b>{lc(data, "educator")}</b></div>}
        {lc(data, "nextSessionDate") && <div><span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>Next session:</span> {lc(data, "nextSessionDate")}</div>}
      </div>
      {arr(lc(data, "topics")).length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#6b21a8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>TOPICS COVERED</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {arr(lc(data, "topics")).map((t) => (
              <span key={t} style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10.5, fontWeight: 700, background: "#fff", color: "#6b21a8", border: "1px solid #e9d5ff" }}>{t}</span>
            ))}
          </div>
        </div>
      )}
      {arr(lc(data, "methods")).length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#6b21a8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>METHODS</div>
          <div style={{ fontSize: 11 }}>{arr(lc(data, "methods")).join(", ")}</div>
        </div>
      )}
      {arr(lc(data, "barriers")).length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#b91c1c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>BARRIERS</div>
          <div style={{ fontSize: 11, color: "#b91c1c" }}>{arr(lc(data, "barriers")).join(", ")}</div>
        </div>
      )}
      {lc(data, "sessionNotes") && (
        <div style={{ marginTop: 4, padding: "4px 8px", background: "#fff", borderRadius: 4, border: "1px dashed #e9d5ff", fontSize: 11, fontStyle: "italic", color: "var(--pf-muted)" }}>
          {lc(data, "sessionNotes")}
        </div>
      )}
    </div>
  );
}

/* ── SBAR / SHIFT HANDOVER ──────────────────────────────────────── */
function matchSBAR(data) {
  return matchKeys(data, ["situation", "background", "assessment", "recommendation"], 3);
}
function SBARPanel({ data }) {
  const rows = [
    ["S", "Situation",      lc(data, "situation"),      "#dc2626"],
    ["B", "Background",     lc(data, "background"),     "#ca8a04"],
    ["A", "Assessment",     lc(data, "assessment"),     "#0284c7"],
    ["R", "Recommendation", lc(data, "recommendation"), "#16a34a"],
  ].filter(([, , v]) => v);
  return (
    <div style={{
      marginTop: 4, padding: "8px 12px", borderRadius: 6,
      background: "linear-gradient(180deg, #f0f9ff 0%, #fff 30%)",
      border: "1px solid #bae6fd", borderLeft: "4px solid #0284c7",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#075985" }}>📋 SBAR HANDOVER</span>
        {lc(data, "type") && (
          <span style={{ padding: "1px 8px", borderRadius: 4, fontSize: 10.5, fontWeight: 700, background: "#e0f2fe", color: "#075985" }}>{lc(data, "type")}</span>
        )}
        {lc(data, "patientStatus") && (
          <span style={{ padding: "1px 8px", borderRadius: 4, fontSize: 10.5, fontWeight: 700, background: "#dcfce7", color: "#166534" }}>{lc(data, "patientStatus")}</span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "22px 90px 1fr", gap: "4px 8px", fontSize: 11.5, alignItems: "baseline" }}>
        {rows.map(([letter, label, text, color]) => (
          <React.Fragment key={letter}>
            <span style={{
              width: 22, height: 22, borderRadius: 4, background: color, color: "#fff",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 12,
            }}>{letter}</span>
            <span style={{ color, fontWeight: 700 }}>{label}</span>
            <span>{text}</span>
          </React.Fragment>
        ))}
      </div>
      {(lc(data, "incomingNurse") || lc(data, "followUpDate")) && (
        <div style={{ marginTop: 6, paddingTop: 4, borderTop: "1px dashed #bae6fd", fontSize: 11, color: "var(--pf-muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {lc(data, "incomingNurse") && <span><b>To:</b> {lc(data, "incomingNurse")}</span>}
          {lc(data, "followUpDate")  && <span><b>Follow-up:</b> {lc(data, "followUpDate")}</span>}
          {lc(data, "educationGiven") && <span style={{ color: "#166534" }}>✓ Education given{lc(data, "educationTopics") ? ` (${lc(data, "educationTopics")})` : ""}</span>}
        </div>
      )}
    </div>
  );
}

// Does this object look like one of our known scales? Match by item-key
// overlap — needs at least 3 of the canonical keys present (case-insens).
function matchScale(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const keys = Object.keys(data).map((k) => k.toLowerCase());
  let best = null;
  for (const [id, scale] of Object.entries(SCORING_SCALES)) {
    const itemKeys = Object.keys(scale.items);
    const hits = itemKeys.filter((k) => keys.includes(k));
    if (hits.length >= Math.min(3, itemKeys.length) && (!best || hits.length > best.hits)) {
      best = { id, scale, hits: hits.length };
    }
  }
  return best ? best.scale : null;
}

function ScoringPanel({ scale, data }) {
  // Look up each item from `data` case-insensitively; preserve scale order.
  const lookup = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const itemRows = Object.entries(scale.items).map(([code, def]) => {
    const raw = lookup[code.toLowerCase()];
    if (raw == null || raw === "") return null;
    const desc = def.values?.[raw] || def.values?.[String(raw)] || null;
    return { code, label: def.label, value: raw, desc };
  }).filter(Boolean);

  // Compute total if all values numeric.
  const numericValues = itemRows
    .map((r) => Number(r.value))
    .filter((n) => Number.isFinite(n));
  const total = numericValues.length === itemRows.length && itemRows.length > 0
    ? numericValues.reduce((a, b) => a + b, 0)
    : null;
  const interp = total != null && scale.interpret ? scale.interpret(total) : null;

  return (
    <div style={{
      marginTop: 4, padding: "6px 10px", background: "#fff",
      borderRadius: 6, border: `1px solid ${scale.accent}30`,
      borderLeft: `3px solid ${scale.accent}`,
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 800, color: scale.accent,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
      }}>{scale.title}</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "30px minmax(140px,1fr) 32px 1fr",
        gap: "2px 8px", fontSize: 11, alignItems: "baseline",
      }}>
        {itemRows.map((r) => (
          <React.Fragment key={r.code}>
            <span style={{ fontFamily: "monospace", color: scale.accent, fontWeight: 700, fontSize: 10.5 }}>{r.code.toUpperCase()}</span>
            <span style={{ color: "#1f2937" }}>{r.label}</span>
            <span style={{ fontWeight: 700, textAlign: "right", fontFamily: "monospace" }}>{r.value}</span>
            <span style={{ color: "#475569" }}>{r.desc || ""}</span>
          </React.Fragment>
        ))}
      </div>
      {interp && (
        <div style={{
          marginTop: 4, paddingTop: 4, borderTop: `1px dashed ${scale.accent}30`,
          display: "flex", alignItems: "center", gap: 8, fontSize: 11,
        }}>
          <span style={{ fontWeight: 800 }}>Total: <span style={{ fontFamily: "monospace", color: scale.accent }}>{total}</span></span>
          <span style={{
            padding: "2px 8px", borderRadius: 4, fontWeight: 700, fontSize: 10.5,
            background: `${interp.color}15`, color: interp.color, border: `1px solid ${interp.color}40`,
          }}>{interp.risk}</span>
        </div>
      )}
    </div>
  );
}

// Render an arbitrary scalar value as plain text. Returns null when the
// leaf is empty, so the caller can decide whether to drop the row entirely.
function renderScalar(v) {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : null;
  if (Array.isArray(v)) {
    const items = v.filter((x) => x != null && x !== "");
    if (!items.length) return null;
    if (items.every((x) => typeof x !== "object")) return items.join(", ");
    return null; // array of objects — handled by MixedFields recursion
  }
  return String(v);
}

// Inline chip for a "label: value" pair. Used to densify dropdown-style
// fields where the value is short (Pallor: Absent, BP: 120/80).
function Chip({ label, value, accent = "#64748b" }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 4,
      padding: "1px 8px", borderRadius: 4,
      background: "#fff", border: "1px solid #e5e7eb",
      fontSize: 11, lineHeight: 1.55, whiteSpace: "nowrap",
      maxWidth: "100%",
    }}>
      <span style={{ color: accent, fontWeight: 700, fontSize: 10 }}>{label}:</span>
      <span style={{ color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </span>
  );
}

/* Sub-objects that represent organ-system findings — when several of
   these appear side-by-side under the same parent (typical of a Doctor
   IA exam), we group them under a single "SYSTEMIC EXAMINATION" header
   so the file reads as a real clinical exam, not a flat dump. */
const SYSTEMIC_KEYS = new Set([
  "resp", "respiratory",
  "cvs", "cardio", "cardiovascular",
  "abdomen", "abdominal", "gi", "git", "gastrointestinal", "perAbdomen", "perabdomen",
  "cns", "neuro", "neurological", "neurology",
  "mskl", "msk", "musculoskeletal", "spine",
  "gu", "genitourinary", "renal",
  "endocrine", "endo",
  "heme", "hema", "hematological",
  "derm", "dermatological", "skin", "integumentary",
  "ent", "head_and_neck", "headandneck", "headAndNeck", "hen",
  "lymph", "lymphatic",
  "ophth", "ophthalmology", "eyes",
  "psy", "psychiatry", "mental",
]);
const isSystemicKey = (k) => SYSTEMIC_KEYS.has(String(k).toLowerCase());

// Render a wrapped "Resp / CVS / Abdomen / CNS" cluster as a single
// SYSTEMIC EXAMINATION block — each system gets its own line of chips,
// labelled by the system name on the left.
function SystemicExamBlock({ systemEntries }) {
  if (!systemEntries.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{
        fontSize: 10, fontWeight: 800, color: "var(--pf-muted)",
        textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4,
      }}>Systemic Examination</div>
      <div style={{ paddingLeft: 8, borderLeft: "2px solid #c7d2fe" }}>
        {systemEntries.map(([k, v]) => (
          <div key={k} style={{
            display: "grid", gridTemplateColumns: "80px 1fr",
            gap: 6, marginBottom: 3, alignItems: "baseline",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: "#4338ca",
              textTransform: "uppercase", letterSpacing: 0.4,
            }}>{titleCase(k)}</div>
            <div><MixedFields data={v} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Recursively render every populated key in a Mixed object. Strategy:
//   • Scalar values (and arrays of scalars) → wrap-flexed chips so dozens
//     of dropdown-style fields fit a couple of lines instead of a wall.
//   • Sub-objects that represent organ systems (Resp/CVS/Abdomen/CNS/…)
//     get grouped together under one SYSTEMIC EXAMINATION header.
//   • Other nested objects → small uppercase header + left-border subsection.
//   • Arrays of objects → numbered subsections.
// Nothing is collapsed or dropped — user said "complete details rkhte hue,
// koi info miss nhi honi chahiye" — just packed more densely.
function MixedFields({ data }) {
  if (!isMeaningful(data)) return null;

  // Bottom of recursion: a primitive sneaking through (e.g. an array
  // element that turned out to be a string).
  if (typeof data !== "object" || Array.isArray(data)) {
    const r = renderScalar(data);
    return r == null ? null : <span style={{ fontSize: 11 }}>{r}</span>;
  }

  // Dispatch order: safety-critical & high-signal record types first,
  // then scoring scales, then generic chip rendering. Each `match*`
  // requires a strong key signature so we don't false-positive.
  if (matchBlood(data))     return <BloodTransfusionPanel data={data} />;
  if (matchSBAR(data))      return <SBARPanel data={data} />;
  if (matchNeuro(data))     return <NeuroPanel data={data} />;
  if (matchProcedure(data)) return <ProcedurePanel data={data} />;
  if (matchWound(data))     return <WoundPanel data={data} />;
  if (matchPain(data))      return <PainPanel data={data} />;
  if (matchIV(data))        return <IVPanel data={data} />;
  if (matchEducation(data)) return <EducationPanel data={data} />;
  if (matchNutrition(data)) return <NutritionPanel data={data} />;
  if (matchDaily(data))     return <DailyAssessmentPanel data={data} />;
  if (matchIO(data))        return <IOPanel data={data} />;
  if (matchVitals(data))    return <VitalsPanel data={data} />;

  // If THIS object looks like a known clinical scoring scale (Braden,
  // Morse, MEWS, GCS), render the dedicated panel instead of the
  // generic chip grid.
  const scale = matchScale(data);
  if (scale) return <ScoringPanel scale={scale} data={data} />;

  const entries = Object.entries(data).filter(([, v]) => isMeaningful(v));
  if (!entries.length) return null;

  // Partition into chip-friendly scalars vs nested-object subsections.
  const scalars = entries.filter(([, v]) =>
    typeof v !== "object" || (Array.isArray(v) && v.every((x) => typeof x !== "object")),
  );
  const subobjects = entries.filter(([, v]) =>
    typeof v === "object" && !Array.isArray(v),
  );
  const arraysOfObjects = entries.filter(([, v]) =>
    Array.isArray(v) && v.some((x) => x != null && typeof x === "object"),
  );

  // Separate organ-system sub-objects (Resp / CVS / Abdomen / CNS / …)
  // so we can render them inside ONE "SYSTEMIC EXAMINATION" wrapper.
  // Single-system payloads still render normally; only group when ≥2.
  const systemicSubs = subobjects.filter(([k]) => isSystemicKey(k));
  const otherSubs    = subobjects.filter(([k]) => !isSystemicKey(k));
  const useSystemicWrap = systemicSubs.length >= 2;

  return (
    <div style={{ fontSize: 11 }}>
      {scalars.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {scalars.map(([k, v]) => {
            const r = renderScalar(v);
            if (r == null) return null;
            return <Chip key={k} label={titleCase(k)} value={r} />;
          })}
        </div>
      )}
      {useSystemicWrap && <SystemicExamBlock systemEntries={systemicSubs} />}
      {(useSystemicWrap ? otherSubs : subobjects).map(([k, v]) => (
        <div key={k} style={{ marginTop: 6 }}>
          <div style={{
            fontSize: 9.5, fontWeight: 800, color: "var(--pf-muted)",
            textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3,
          }}>{titleCase(k)}</div>
          <div style={{ paddingLeft: 8, borderLeft: "2px solid #e5e7eb" }}>
            <MixedFields data={v} />
          </div>
        </div>
      ))}
      {arraysOfObjects.map(([k, arr]) => (
        <div key={k} style={{ marginTop: 6 }}>
          <div style={{
            fontSize: 9.5, fontWeight: 800, color: "var(--pf-muted)",
            textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3,
          }}>{titleCase(k)} ({arr.length})</div>
          <div style={{ paddingLeft: 8, borderLeft: "2px solid #e5e7eb" }}>
            {arr.map((it, i) => (
              <div key={i} style={{ padding: "2px 0", borderTop: i ? "1px dotted #f1f5f9" : "none" }}>
                <span style={{ fontSize: 9, color: "var(--pf-muted)", fontWeight: 700, marginRight: 4 }}>#{i + 1}</span>
                <MixedFields data={it} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Inline summary for a vitals object — keeps the high-information density
// of a one-line read (BP 120/80 · Pulse 78 · Temp 98.6 · SpO2 99).
function VitalsInline({ vitals }) {
  if (!isMeaningful(vitals)) return null;
  const parts = [];
  if (vitals.bp && (vitals.bp.systolic || vitals.bp.diastolic))
    parts.push(`BP ${vitals.bp.systolic ?? "?"}/${vitals.bp.diastolic ?? "?"}`);
  if (vitals.pulse  != null && vitals.pulse  !== "") parts.push(`Pulse ${vitals.pulse}`);
  if (vitals.temp   != null && vitals.temp   !== "") parts.push(`Temp ${vitals.temp}°F`);
  if (vitals.rr     != null && vitals.rr     !== "") parts.push(`RR ${vitals.rr}`);
  if (vitals.spo2   != null && vitals.spo2   !== "") parts.push(`SpO2 ${vitals.spo2}%`);
  if (vitals.bloodSugar != null && vitals.bloodSugar !== "") parts.push(`BS ${vitals.bloodSugar} mg/dL`);
  if (!parts.length) return null;
  return (
    <p style={{ margin: "4px 0", padding: "6px 10px", background: "#f8fafc", borderRadius: 4, fontFamily: "monospace", fontSize: 12 }}>
      📊 {parts.join("  ·  ")}
    </p>
  );
}

function NoteList({ notes, kind, emptyMsg }) {
  if (!notes?.length) return <Empty msg={emptyMsg || "No records yet"} />;
  return notes.map((n) => {
    // Build the "general condition" pill list for nurse notes — only
    // include flags the nurse actually ticked.
    const gcFlags = Object.entries(n.generalCondition || {})
      .filter(([, v]) => v === true)
      .map(([k]) => titleCase(k));

    // I/O totals — only show when something was logged.
    const io = n.intakeOutput || {};
    const ioParts = [];
    if (io.oral)        ioParts.push(`Oral ${io.oral} ml`);
    if (io.ivFluids)    ioParts.push(`IV ${io.ivFluids} ml`);
    if (io.urineOutput) ioParts.push(`Urine ${io.urineOutput} ml`);
    if (io.otherOutput) ioParts.push(`Other-out ${io.otherOutput} ml`);

    // Nursing-care checklist — only the checked items.
    const careDone = Object.entries(n.nursingCare || {})
      .filter(([k, v]) => v === true && k !== "otherCare")
      .map(([k]) => titleCase(k));

    return (
      <div key={n._id} className={`pf-record pf-record--${kind}`}>
        <div className="pf-record__head">
          <span className="pf-record__title">
            {n.doctorName || n.nurseName || "Staff"} — {n.noteType || "note"}
          </span>
          <span className="pf-record__time">{fmtDT(n.visitDate || n.noteDate || n.createdAt)}</span>
          {n.status && <span className={`pf-badge ${["signed","submitted"].includes(n.status) ? "pf-badge--ok" : "pf-badge--warn"}`}>{n.status}</span>}
          {n.shift && <span className="pf-badge pf-badge--neutral">{n.shift}</span>}
          {(n.isCritical || n.isCriticalEvent) && (
            <span className="pf-badge pf-badge--err" role="status" aria-label="Critical event">🚨 CRITICAL</span>
          )}
        </div>

        <div className="pf-record__body pf-record__body--dense">
          {/* SOAP — render as a tight 2-col grid so the four letters
              stay in line and the prose flows next to them. Only
              populated lines appear. */}
          {n.soap && (n.soap.subjective || n.soap.objective || n.soap.assessment || n.soap.plan) && (
            <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: "1px 8px", fontSize: 12, marginBottom: 4 }}>
              {n.soap.subjective && (<><b>S</b><span>{n.soap.subjective}</span></>)}
              {n.soap.objective  && (<><b>O</b><span>{n.soap.objective}</span></>)}
              {n.soap.assessment && (<><b>A</b><span>{n.soap.assessment}</span></>)}
              {n.soap.plan       && (<><b>P</b><span>{n.soap.plan}</span></>)}
            </div>
          )}

          {/* Diagnoses + coding — one wrap-flex row of chips */}
          {(n.provisionalDiagnosis || n.workingDiagnosis || n.finalDiagnosis || n.icd10Code || n.icd10Description || n.snomedCode || n.snomedDisplay) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
              {n.provisionalDiagnosis && <Chip label="Provisional Dx" value={n.provisionalDiagnosis} accent="#7c3aed" />}
              {n.workingDiagnosis     && <Chip label="Working Dx"     value={n.workingDiagnosis}     accent="#7c3aed" />}
              {n.finalDiagnosis       && <Chip label="Final Dx"       value={n.finalDiagnosis}       accent="#7c3aed" />}
              {(n.icd10Code || n.icd10Description) && <Chip label="ICD-10" value={[n.icd10Code, n.icd10Description].filter(Boolean).join(" — ")} accent="#0284c7" />}
              {(n.snomedCode || n.snomedDisplay)   && <Chip label="SNOMED" value={[n.snomedCode, n.snomedDisplay].filter(Boolean).join(" — ")} accent="#0284c7" />}
            </div>
          )}

          {/* Vitals — single dense pill */}
          <VitalsInline vitals={n.vitals} />

          {/* Investigations + orders — chip row */}
          {((Array.isArray(n.investigations) && n.investigations.length > 0) || (Array.isArray(n.orders) && n.orders.length > 0)) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
              {Array.isArray(n.investigations) && n.investigations.length > 0 && (
                <Chip label={`Investigations (${n.investigations.length})`} value={n.investigations.filter(Boolean).join(", ")} accent="#0284c7" />
              )}
              {Array.isArray(n.orders) && n.orders.length > 0 && (
                <Chip label={`Orders (${n.orders.length})`} value={`${n.orders.map((o) => o.instruction).filter(Boolean).slice(0, 3).join(" · ")}${n.orders.length > 3 ? " · …" : ""}`} accent="#ea580c" />
              )}
            </div>
          )}

          {/* Nurse-specific structured blocks — all in one chip row */}
          {(gcFlags.length > 0 || n.painScore > 0 || n.painAssessment || isMeaningful(n.ivLine) || ioParts.length > 0 || careDone.length > 0 || n.nursingCare?.otherCare) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
              {gcFlags.length > 0 && <Chip label="Gen. condition" value={gcFlags.join(", ")} accent="#db2777" />}
              {(n.painScore > 0 || n.painAssessment) && (
                <Chip label="Pain" value={`${n.painScore != null ? `${n.painScore}/10` : ""}${n.painAssessment ? ` · ${n.painAssessment}` : ""}`.trim()} accent="#db2777" />
              )}
              {n.ivLine && isMeaningful(n.ivLine) && (
                <Chip label="IV line" value={[n.ivLine.site, n.ivLine.condition, n.ivLine.notes].filter(Boolean).join(" · ")} accent="#0d9488" />
              )}
              {ioParts.length > 0 && <Chip label="I/O" value={`${ioParts.join(" · ")}${io.notes ? ` — ${io.notes}` : ""}`} accent="#0d9488" />}
              {(careDone.length > 0 || n.nursingCare?.otherCare) && (
                <Chip label="Nursing care" value={[...careDone, n.nursingCare?.otherCare].filter(Boolean).join(", ")} accent="#db2777" />
              )}
            </div>
          )}

          {/* Mixed payloads — denser panel, no big header label */}
          {isMeaningful(n.noteDetails) && (
            <div style={{ marginTop: 4, padding: "6px 8px", background: "#f8fafc", borderRadius: 4, borderLeft: "3px solid #7c3aed" }}>
              <MixedFields data={n.noteDetails} />
            </div>
          )}
          {isMeaningful(n.noteData) && (
            <div style={{ marginTop: 4, padding: "6px 8px", background: "#f8fafc", borderRadius: 4, borderLeft: "3px solid #db2777" }}>
              <MixedFields data={n.noteData} />
            </div>
          )}

          {/* Free-text fallbacks — tight margins */}
          {(n.remarks || n.note || n.noteText || n.content) && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {n.remarks  && <div>{n.remarks}</div>}
              {n.note     && <div>{n.note}</div>}
              {n.noteText && <div>{n.noteText}</div>}
              {n.content  && <div>{n.content}</div>}
            </div>
          )}

          {/* Tags */}
          {Array.isArray(n.tags) && n.tags.length > 0 && (
            <div style={{ marginTop: 3 }}>
              {n.tags.map((t) => <span key={t} className="pf-badge pf-badge--neutral" style={{ marginRight: 3, fontSize: 9.5 }}>{t}</span>)}
            </div>
          )}
          {n.patientStatus && <Chip label="Status" value={n.patientStatus} accent="#64748b" />}

          {n.signedByName && (
            <div style={{ fontStyle: "italic", color: "var(--pf-muted)", fontSize: 10.5, marginTop: 4, borderTop: "1px dotted #e5e7eb", paddingTop: 3 }}>
              Signed by {n.signedByName}{n.signedByReg ? ` (Reg ${n.signedByReg})` : ""} on {fmtDT(n.signedAt || n.submittedAt)}
            </div>
          )}
        </div>
      </div>
    );
  });
}

function OrdersSection({ orders }) {
  if (!orders?.length) return <Empty icon="💊" msg="No orders placed yet" />;
  // Surface pending / active orders at the top so the bedside view
  // always answers "what's left to do" first.
  const PENDING_STATUSES = new Set(["Pending", "Active", "InProgress", "OnHold"]);
  const sorted = [...orders].sort((a, b) => {
    const aP = PENDING_STATUSES.has(a.status), bP = PENDING_STATUSES.has(b.status);
    if (aP !== bP) return aP ? -1 : 1;
    return new Date(b.orderedAt || b.createdAt) - new Date(a.orderedAt || a.createdAt);
  });
  const pendingCount = sorted.filter((o) => PENDING_STATUSES.has(o.status)).length;

  return (
    <>
      {pendingCount > 0 && (
        <div style={{
          marginBottom: 6, padding: "4px 10px", borderRadius: 4,
          background: "#fef3c7", border: "1px solid #fde68a",
          fontSize: 11, fontWeight: 700, color: "#92400e",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          ⏳ {pendingCount} order{pendingCount !== 1 ? "s" : ""} pending / active
        </div>
      )}
      <table className="pf-table pf-table--compact">
        <thead>
          <tr>
            <th>When</th><th>Drug / Order</th><th>Dose / Rate</th>
            <th>Route</th><th>Frequency</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => {
            const isPending = PENDING_STATUSES.has(o.status);
            const rowStyle = isPending ? {
              background: "linear-gradient(90deg, #fffbeb 0%, transparent 100%)",
              borderLeft: "3px solid #f59e0b",
            } : undefined;
            return (
              <tr key={o._id} style={rowStyle}>
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
                    ["OnHold", "Pending", "Active"].includes(o.status) ? "pf-badge--warn" :
                    "pf-badge--neutral"
                  }`}>{isPending ? `⏳ ${o.status}` : o.status}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function VitalsSection({ vitals, nurseNotes, doctorNotes, currentAdmission }) {
  // Merge dedicated VitalSheet rows + vitals embedded inside nurse notes,
  // doctor notes, and the admission-level nurse IA payload. Dedupe on
  // (timestamp minute, BP, pulse).
  //
  // R7g: previously this was VitalSheet+NurseNote only. Doctor notes,
  // admission-level IA, and noteDetails.systemic.* readings were silently
  // missing from the trend table — the printed file showed only nursing-
  // recorded vitals, not the doctor's clinical observations.
  const merged = useMemo(() => {
    const rows = [];
    const fmtBp = (bp) => {
      if (!bp) return "—";
      if (typeof bp === "string") return bp || "—";
      const sys = bp.systolic ?? bp.sys ?? bp.bp_sys;
      const dia = bp.diastolic ?? bp.dia ?? bp.bp_dia;
      return `${sys ?? "—"}/${dia ?? "—"}`;
    };
    const pushFrom = (v, when, by, source) => {
      if (!v) return;
      const bpRaw = v.bp || (v.bp_sys ? { systolic: v.bp_sys, diastolic: v.bp_dia } : null);
      if (!bpRaw && !v.pulse && !v.temp && !v.temperature && !v.spo2 && !v.rr && !v.respiratoryRate) return;
      rows.push({
        when, by, source,
        bp: fmtBp(bpRaw),
        pulse: v.pulse || "—",
        temp: v.temperature || v.temp || "—",
        rr: v.rr || v.respiratoryRate || "—",
        spo2: v.spo2 || "—",
        bsl: v.bsl || v.bloodSugar || "—",
        gcs: v.gcs || "—",
      });
    };
    (vitals || []).forEach((v) =>
      pushFrom(v, v.recordedAt || v.createdAt, v.recordedBy || v.nurseName || "—", "VitalSheet"));
    (nurseNotes || []).forEach((n) =>
      pushFrom(n.vitals, n.noteDate || n.createdAt, n.nurseName || "—", "NurseNote"));
    (doctorNotes || []).forEach((n) => {
      pushFrom(n.vitals, n.visitDate || n.createdAt, n.doctorName || n.signedBy || "—", "DoctorNote");
      // Some doctor notes carry vitals inside noteDetails.systemic.* (per-system exam block)
      const sys = n.noteDetails?.systemic;
      if (sys && typeof sys === "object") {
        Object.values(sys).forEach((blk) => {
          if (blk && typeof blk === "object" && (blk.bp || blk.pulse || blk.spo2 || blk.rr || blk.temp)) {
            pushFrom(blk, n.visitDate || n.createdAt, n.doctorName || n.signedBy || "—", "DoctorNote (systemic)");
          }
        });
      }
    });
    if (currentAdmission?.nurseInitialAssessment?.vitals) {
      pushFrom(currentAdmission.nurseInitialAssessment.vitals,
        currentAdmission.admissionDate || currentAdmission.createdAt,
        currentAdmission.nurseInitialAssessment.assessedBy || "Admission IA",
        "IA");
    }
    if (currentAdmission?.initialAssessment?.vitals) {
      pushFrom(currentAdmission.initialAssessment.vitals,
        currentAdmission.admissionDate || currentAdmission.createdAt,
        currentAdmission.initialAssessment.assessedBy || "Doctor IA",
        "IA (Doctor)");
    }
    rows.sort((a, b) => new Date(b.when) - new Date(a.when));
    // Dedupe by minute precision
    const seen = new Set();
    return rows.filter((r) => {
      if (!r.when) return false;
      const key = `${new Date(r.when).toISOString().slice(0, 16)}|${r.bp}|${r.pulse}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [vitals, nurseNotes, doctorNotes, currentAdmission]);

  if (!merged.length) return <Empty icon="📈" msg="No vitals captured" />;
  return (
    <table className="pf-table pf-table--compact">
      <thead>
        <tr>
          <th>When</th><th>By</th><th>Source</th><th>BP</th><th>Pulse</th>
          <th>Temp</th><th>RR</th><th>SpO₂</th><th>BSL</th><th>GCS</th>
        </tr>
      </thead>
      <tbody>
        {merged.slice(0, 200).map((r, i) => (
          // Deterministic key from the row's actual data — `key={i}` was
          // breaking reconciliation when new vitals were inserted mid-stream.
          <tr key={`${r.when || ""}|${r.bp}|${r.pulse}|${i}`}>
            <td>{fmtDT(r.when)}</td><td>{r.by}</td>
            <td style={{ fontSize: 11, color: "#64748b" }}>{r.source || "—"}</td>
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
  // Wrap in a fragment so this works as a section child even though
  // .map() returns an array. Guard against rows missing _id (would
  // collapse all duplicates onto one undefined-keyed slot otherwise).
  return (
    <>
    {consents.map((c, i) => (
    <div key={c._id || `consent-${i}`} className="pf-record pf-record--consent">
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
    ))}
    </>
  );
}

function InvestigationSection({ investigations }) {
  if (!investigations?.length) return <Empty icon="🧪" msg="No investigations ordered" />;
  // Pending orders first, then completed. Per-test status pills make
  // the bottleneck (sample not collected? result not entered?) visible.
  const isOrderPending = (o) => o.orderStatus !== "COMPLETED" && o.orderStatus !== "CANCELLED";
  const sorted = [...investigations].sort((a, b) => {
    const aP = isOrderPending(a), bP = isOrderPending(b);
    if (aP !== bP) return aP ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const pendingTests = sorted.reduce((sum, o) => sum + (o.items || []).filter((it) => it.resultStatus !== "COMPLETED" && it.resultStatus !== "REPORTED").length, 0);

  const sampleColor = (s) => /collected|in.?process|received/i.test(s) ? "#ca8a04"
                           : /completed|resulted/i.test(s)             ? "#16a34a"
                           : /pending|awaiting/i.test(s)               ? "#dc2626"
                           : "#64748b";
  const resultColor = (s) => /completed|reported|resulted/i.test(s)    ? "#16a34a"
                           : /partial|in.?process/i.test(s)            ? "#ca8a04"
                           : "#dc2626";
  const sampleIcon  = (s) => /completed|resulted/i.test(s) ? "✓"
                           : /collected|in.?process/i.test(s) ? "🧪"
                           : "⏳";

  return (
    <>
      {pendingTests > 0 && (
        <div style={{
          marginBottom: 6, padding: "4px 10px", borderRadius: 4,
          background: "#fef3c7", border: "1px solid #fde68a",
          fontSize: 11, fontWeight: 700, color: "#92400e",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          ⏳ {pendingTests} test{pendingTests !== 1 ? "s" : ""} awaiting sample / result
        </div>
      )}
      {sorted.map((o) => {
        const orderPending = isOrderPending(o);
        return (
          <div key={o._id} className="pf-record" style={orderPending ? { borderLeft: "4px solid #f59e0b" } : undefined}>
            <div className="pf-record__head">
              <span className="pf-record__title">Order — {fmtDate(o.createdAt)}</span>
              <span className={`pf-badge ${o.orderStatus === "COMPLETED" ? "pf-badge--ok" : "pf-badge--warn"}`}>
                {orderPending ? `⏳ ${o.orderStatus}` : o.orderStatus}
              </span>
              <span className="pf-record__time">By {o.doctorName || "—"}</span>
            </div>
            <table className="pf-table pf-table--compact">
              <thead><tr><th>Test</th><th>Sample</th><th>Result</th><th>Findings</th></tr></thead>
              <tbody>
                {(o.items || []).map((it, i) => {
                  const sc = sampleColor(it.sampleStatus || "");
                  const rc = resultColor(it.resultStatus || "");
                  const pending = it.resultStatus !== "COMPLETED" && it.resultStatus !== "REPORTED";
                  return (
                    <tr key={i} style={pending ? { background: "#fffbeb" } : undefined}>
                      <td><strong>{it.investigationName}</strong></td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 7px", borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                          background: `${sc}15`, color: sc, border: `1px solid ${sc}40` }}>
                          {sampleIcon(it.sampleStatus || "")} {it.sampleStatus || "—"}
                        </span>
                      </td>
                      <td>
                        <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                          background: `${rc}15`, color: rc, border: `1px solid ${rc}40` }}>
                          {it.resultStatus || "—"}
                        </span>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {(it.results || []).length > 0
                          ? (it.results || []).map((r) => `${r.parameter}: ${r.value} ${r.unit || ""}`).join("; ")
                          : <span style={{ color: "#94a3b8", fontStyle: "italic" }}>awaiting…</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

// Dietician's nutritional assessments + assigned diet plans for this
// patient. Each card shows the assessment vitals, the active template
// (or "Custom"), target macros, customisations, meal snapshot count,
// and a follow-up date. Read-only display — writes happen in the
// /dietitian console. When the viewer IS a Dietician, we show an
// "Edit in Console" CTA that opens the assessment tab pre-scoped to
// this patient so they can revise or add a plan without losing the
// clinical context they're reading on this page.
function DietPlansSection({ dietPlans, uhid, viewerRole }) {
  const isDietician = viewerRole === "Dietician";
  const openConsole = (extra = "") => {
    const u = encodeURIComponent(uhid || "");
    window.open(`/dietitian?tab=assessment&uhid=${u}${extra}`, "_blank", "noopener,noreferrer");
  };

  if (!dietPlans?.length) {
    return (
      <>
        <Empty icon="🥗" msg="No dietician assessments or diet plans on file" />
        {isDietician && uhid && (
          <div style={{ marginTop: 8, textAlign: "center" }}>
            <button onClick={() => openConsole()}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #16a34a40", background: "#f0fdf4", color: "#16a34a", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              + New nutritional assessment
            </button>
          </div>
        )}
      </>
    );
  }
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
          {isDietician && uhid && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px dashed #e5e7eb", textAlign: "right" }}>
              <button onClick={() => openConsole(d._id ? `&plan=${encodeURIComponent(d._id)}` : "")}
                style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #16a34a40", background: "#fff", color: "#16a34a", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                ✏ Edit in console
              </button>
            </div>
          )}
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
function PrintLetterhead({ patient, currentAdmission, role, hs = {} }) {
  const initials = (patient?.fullName || "P").split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const ageDisp = patient?.age || (patient?.dateOfBirth
    ? Math.floor((Date.now() - new Date(patient.dateOfBirth)) / (365.25 * 24 * 3600 * 1000)) + "y"
    : "—");
  // R7cb-B: hospital identity from live Settings — hospitalName replaces the
  // legacy hardcoded brand and tagline becomes admin-configurable.
  const hospName    = hs.hospitalName || "Hospital";
  const hospTagline = hs.tagline || "";
  const logoLetter  = (hospName.trim() || "H").charAt(0).toUpperCase();
  return (
    <header className="pf-print-letterhead">
      <div className="pf-print-letterhead__brand">
        {hs.logo
          ? <img src={hs.logo} alt="" className="pf-print-letterhead__logo" style={{ maxHeight: 48, objectFit: "contain" }} />
          : <div className="pf-print-letterhead__logo">{logoLetter}</div>}
        <div>
          <div className="pf-print-letterhead__hospital">{hospName}</div>
          {hospTagline && <div className="pf-print-letterhead__sub">{hospTagline}</div>}
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

function PrintBody({ data, docInitial, nurseInitial, docOther, nurseOther, viewerRole,
  // R7fq Track D: PrintShell needs the same identity/admission props the
  // retired PrintLetterhead used to consume, plus the live hospital
  // settings + the viewer's display name/role for the signed-by stamp.
  patient = {}, hospitalSettings = {}, viewerName = "", role = "doctor", uhid = "" }) {
  // dietPlans was missing from this destructure — PrintSection 9a was
  // reading a free variable that didn't exist, crashing the print popup.
  // (Audit finding HIGH-3.)
  // icuBundles surfaces every per-shift VAP/CAUTI/CLABSI/DVT/Sepsis/SUP
  // sheet for the current admission so NABH surveyors see them in the
  // printable file (HIC.5 + COP.13 + IPSG.5).
  const { currentAdmission, doctorOrders, vitals, nurseNotes, doctorNotes,
    consents, investigations, mlc, dischargeSummary, bills, activityLog,
    bedTransfers, shiftHandovers, dietPlans, nursingAssessments, nursingCarePlans, timeline,
    icuBundles = [] } = data;

  // R7k: NABH-compliant chronological clinical narrative.
  // Previously this print rendered "4. Doctor Notes" then "5. Nursing
  // Notes" as two separate blocks grouped by author. The medical-record
  // standard (and what auditors expect) is a single continuous narrative
  // ordered by encounter time — Day 1 doctor round → Day 1 nurse note →
  // Day 1 evening note → Day 2 …. We merge docOther + nurseOther and
  // sort by visitDate/createdAt ascending.
  const chronologicalNotes = React.useMemo(() => {
    const items = [];
    for (const n of (docOther || [])) {
      const when = n.visitDate || n.createdAt;
      if (!when) continue;
      items.push({ kind: "doctor", when: new Date(when), note: n });
    }
    for (const n of (nurseOther || [])) {
      const when = n.visitDate || n.noteDate || n.createdAt;
      if (!when) continue;
      items.push({ kind: "nurse", when: new Date(when), note: n });
    }
    items.sort((a, b) => a.when - b.when);
    return items;
  }, [docOther, nurseOther]);

  // R7k: Same-day filter for shift handovers. Handovers are operational
  // shift-to-shift notes — once the day rolls over they pollute the
  // permanent record. NABH wants the printed file to reflect a clean
  // clinical narrative, so we only print handovers from today.
  const startOfToday = React.useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const todaysHandovers = React.useMemo(
    () => (shiftHandovers || []).filter((h) =>
      h.createdAt && new Date(h.createdAt) >= startOfToday,
    ),
    [shiftHandovers, startOfToday],
  );

  // R7k: Blood transfusion records — extracted from any nurse note whose
  // noteData payload matches the blood-transfusion shape. NABH MOM.7
  // requires a dedicated audit-friendly transfusion register that lists
  // every bag with cross-match + pre/post vitals + reaction status —
  // not buried inside generic nursing notes.
  const bloodTransfusionEntries = React.useMemo(
    () => (nurseNotes || [])
      .filter((n) => matchBlood(n.noteData))
      .sort((a, b) => new Date(a.visitDate || a.createdAt) - new Date(b.visitDate || b.createdAt)),
    [nurseNotes],
  );

  // R7fq Track D: assemble the patient-info strip the shell renders
  // under the title bar. Two logical columns flattened into one ordered
  // list — PrintShell.css uses column-count:2 so they paginate as a
  // side-by-side grid, matching the SGRH/Max print layout.
  const infoItems = currentAdmission
    ? [
        { label: "UHID",        value: patient.UHID },
        { label: "Patient Name",value: patient.fullName },
        { label: "Age",         value: patient.age },
        { label: "Sex",         value: patient.gender },
        { label: "Blood Group", value: patient.bloodGroup || "—" },
        { label: "Contact",     value: patient.contactNumber },
        { label: "IP No",       value: currentAdmission.admissionNumber },
        { label: "Admit Date",  value: fmtDate(currentAdmission.admissionDate) },
        { label: "Status",      value: currentAdmission.status },
        { label: "Ward/Bed",    value: `${currentAdmission.wardName || ""}/${currentAdmission.bedNumber || ""}` },
        { label: "Consultant",  value: currentAdmission.attendingDoctor || "—" },
        { label: "Diagnosis",   value: currentAdmission.provisionalDiagnosis || "—" },
      ]
    : [
        { label: "UHID",        value: patient.UHID },
        { label: "Patient Name",value: patient.fullName },
        { label: "Age",         value: patient.age },
        { label: "Sex",         value: patient.gender },
        { label: "Blood Group", value: patient.bloodGroup || "—" },
        { label: "Contact",     value: patient.contactNumber },
        { label: "Type",        value: "OPD History" },
        { label: "Total OPD Visits", value: patient.totalOPDVisits || 0 },
        { label: "Total IPD Visits", value: patient.totalIPDVisits || 0 },
        { label: "Last Visit",  value: fmtDate(patient.lastVisitDate) },
      ];
  const docTitle = "Complete Patient File";
  const docSubtitle = currentAdmission
    ? `IPD ${currentAdmission.admissionNumber || "—"} — ${currentAdmission.wardName || ""}`
    : "OPD History";
  // Subtitle is appended into the document title (the shell exposes one
  // title slot + one serial slot). The shell's serial slot takes the
  // IP/UHID so each printed page carries the doc number on its title bar.
  const fullTitle = `${docTitle} · ${docSubtitle}`;
  const serialNo  = currentAdmission?.admissionNumber || patient.UHID || "";
  // Override the signed-by stamp the shell footer renders so a
  // doctor-view print shows "Consultant", a nurse-view print shows
  // "Senior Nurse" — instead of falling back to whichever user happens
  // to be on that browser tab.
  const signedBy = {
    name: viewerName || "Treating Team",
    role: role === "nurse" ? "Senior Nurse" : "Consultant",
  };

  return (
    <PrintShell
      settings={hospitalSettings}
      documentTitle={fullTitle}
      serialNo={serialNo}
      infoItems={infoItems}
      signedBy={signedBy}
      showBank={false}
      showSignatures={true}
      showTerms={true}
    >
    <main className="pf-print-body" data-uhid={uhid}>
      <PrintSection title="1. Admission Summary">
        <AdmissionSection admission={currentAdmission} />
      </PrintSection>

      <PrintSection title="2. Initial Assessment — Doctor">
        <div style={{ marginBottom: 8, fontSize: 11, color: "#78350f", fontStyle: "italic" }}>
          Showing latest signed version. Full amendment history visible in Activity Log.
        </div>
        <NoteList notes={docInitial.filter((n) => n.section === "doctor" || (!n.section && n.noteDetails?.doctor) || (!n.section && !n.noteDetails?.nursing))} kind="doctor" emptyMsg="Doctor initial assessment not recorded" />
      </PrintSection>

      <PrintSection title="3. Initial Assessment — Nursing">
        <NoteList notes={[
          ...docInitial.filter((n) => n.section === "nursing" || n.noteDetails?.nursing),
          ...nurseInitial,
        ]} kind="nurse" emptyMsg="Nursing initial assessment not recorded" />
      </PrintSection>

      {/* R7k: ONE chronological progress-notes section instead of two
          author-grouped blocks. Each entry keeps its kind tag (Doctor /
          Nurse) but they're interleaved by encounter time so the
          reviewing clinician sees the actual order of care. */}
      <PrintSection title="4. Progress Notes (chronological)">
        {chronologicalNotes.length === 0
          ? <Empty icon="📝" msg="No progress notes on file" />
          : chronologicalNotes.map(({ kind, note }, i) => (
              <NoteList key={`${note._id}-${i}`} notes={[note]} kind={kind} />
            ))
        }
      </PrintSection>

      {/* R7k: Procedure notes — separate dedicated section per NABH.
          Pulled from BOTH doctorNotes + nurseNotes when their noteType
          looks procedural OR noteDetails/noteData payload matches the
          procedure shape. The same component used in interactive view. */}
      <PrintSection title="5. Procedure Notes">
        <ProcedureNotesSection doctorNotes={doctorNotes || []} nurseNotes={nurseNotes || []} />
      </PrintSection>

      <PrintSection title="6. Orders + MAR">
        <OrdersSection orders={doctorOrders} />
      </PrintSection>

      {/* R7fz — page parity: Intake / Output sheet was on-page only
          (Section id="io-sheet"). Now mirrored to print so the
          printed file matches the on-screen view 1:1. */}
      <PrintSection title="6c. Intake / Output Sheet">
        <IOSheetSection nurseNotes={nurseNotes} currentAdmission={currentAdmission} />
      </PrintSection>

      {/* R7l: Day-by-day NABH MOM.3 treatment chart. For each day of
          the stay, every active medication (+IV/oxygen) shows its
          scheduled doses with a green ✓ when administered, the
          nurse's name, and the actual administration time. Pages
          break between days (pageBreakInside: avoid).
          NEW (R7eg2): per-day footer summarises ICU care bundles
          finalized on that day so the bedside MAR + bundle compliance
          are side-by-side. */}
      <PrintSection title="6a. Treatment Chart — Day-wise (NABH MOM.3)">
        <TreatmentChartPrintSection
          doctorOrders={doctorOrders}
          currentAdmission={currentAdmission}
          icuBundles={icuBundles}
        />
      </PrintSection>

      {/* R7eg2: ICU Care Bundles (NABH HIC.5 / COP.13 / IPSG.5). One block
          per (date, shift) sheet — VAP / CAUTI / CLABSI / DVT / Sepsis /
          SUP each with their checklist items (✓ / ✗ / N/A), per-bundle
          compliance %, and the nurse who signed. Page-break between days
          so a long ICU stay paginates cleanly. */}
      {(icuBundles?.length || 0) > 0 && (
        <PrintSection title="6b. ICU Care Bundles (NABH HIC.5 / COP.13)">
          <ICUBundlesPrintSection bundles={icuBundles} />
        </PrintSection>
      )}

      <PrintSection title="7. Vital Trends">
        <VitalsSection vitals={vitals} nurseNotes={nurseNotes} doctorNotes={doctorNotes} currentAdmission={currentAdmission} />
      </PrintSection>

      {/* R7k: Dedicated Blood Transfusion Records (NABH MOM.7).
          Previously these scattered across generic nurse notes — auditors
          had to hunt for each transfusion. Now every blood event with
          its bag number, cross-match, pre/post vitals, monitoring entries
          and reaction status appears in one chronological list. */}
      {bloodTransfusionEntries.length > 0 && (
        <PrintSection title="8. Blood Transfusion Records (NABH MOM.7)">
          {bloodTransfusionEntries.map((n) => (
            <div key={n._id} className="pf-record pf-record--nurse" style={{ marginBottom: 8 }}>
              <div className="pf-record__head">
                <span className="pf-record__title">Transfusion event</span>
                <span className="pf-record__time">{fmtDT(n.visitDate || n.createdAt)}</span>
                <span className="pf-record__by">by {n.nurseName || "Nurse"}</span>
              </div>
              <BloodTransfusionPanel data={n.noteData} />
            </div>
          ))}
        </PrintSection>
      )}

      <PrintSection title="9. Investigations">
        <InvestigationSection investigations={investigations} />
      </PrintSection>

      <PrintSection title="10. Consent Forms">
        <ConsentSection consents={consents} />
      </PrintSection>

      {/* Care Plans (NABH COP.3) — fetched but never rendered prior to
          R7k. Surfaced here so the print includes the nurse's care-plan
          documentation. */}
      {(nursingCarePlans?.length || 0) > 0 && (
        <PrintSection title="10a. Nursing Care Plans">
          <CarePlansSection carePlans={nursingCarePlans} />
        </PrintSection>
      )}

      {/* Nutrition / Patient Education / Daily nursing assessments —
          all live on the NursingAssessment model and were fetched but
          never rendered. R7k closes that silent gap. */}
      {(nursingAssessments?.length || 0) > 0 && (
        <PrintSection title="10b. Nutritional & Patient-Education Assessments">
          <NursingAssessmentsSection assessments={nursingAssessments} />
        </PrintSection>
      )}

      {/* Dietician — nutritional assessments + assigned plans. Shown
          whenever any plan exists so the treating doctor / nurse on
          rounds can see what nutritional orders are in effect. */}
      {(dietPlans?.length || 0) > 0 && (
        <PrintSection title="10c. Dietician — Diet Plans">
          <DietPlansSection dietPlans={dietPlans} />
        </PrintSection>
      )}

      {mlc?.length > 0 && (
        <PrintSection title="11. Medico-Legal Cases">
          <MLCSection mlc={mlc} />
        </PrintSection>
      )}

      {/* R7k: Bed Transfers stay in the permanent record (NABH AAC.3).
          They mark changes in level of care and need to be auditable. */}
      <PrintSection title="12. Bed Transfers">
        {(bedTransfers?.length || 0) === 0
          ? <Empty icon="🛏" msg="No bed transfers recorded" />
          : bedTransfers.map((t) => (
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
            ))
        }
      </PrintSection>

      {/* R7k: Shift Handovers — same-day only. NABH treats SBAR shift
          handovers as operational shift-to-shift continuity notes, NOT
          part of the permanent clinical record. The interactive view
          still shows the full history; the printed record carries only
          today's handovers so the file isn't bloated with shift
          ephemera from earlier days. */}
      {todaysHandovers.length > 0 && (
        <PrintSection title="12a. Today's Shift Handovers (SBAR — same-day)">
          {todaysHandovers.map((h) => (
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
        </PrintSection>
      )}

      <PrintSection title="13. Discharge Summary">
        <DischargeSection dischargeSummary={dischargeSummary} />
      </PrintSection>

      <PrintSection title="14. Billing Summary">
        <BillingSection bills={bills} />
      </PrintSection>

      {/* R7fz — page parity: Scoring Trends + Complete Timeline +
          Unified Timeline existed on-page only. Now mirrored to
          print so the printed file matches the on-screen view 1:1. */}
      <PrintSection title="14a. Scoring Trends">
        <ScoringTrendsSection nurseNotes={nurseNotes} doctorNotes={doctorNotes} currentAdmission={currentAdmission} />
      </PrintSection>

      <PrintSection title="14b. Complete Timeline">
        <TimelineSection data={data} />
      </PrintSection>

      {/* R7g: Activity Log restricted to audit-eligible roles in print
          (matches interactive view NABH AAC.7). */}
      {["Admin", "Doctor", "MRD", "Accountant"].includes(viewerRole) && (
        <PrintSection title="15. Activity / Audit Trail (latest 50)">
          <ActivityFeed activityLog={(activityLog || []).slice(0, 50)} />
        </PrintSection>
      )}
    </main>
    </PrintShell>
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

/* ── Scoring Trends — one timeline-table per scale across time ─────
   Walks every nurse note (and the admission-stored nurseInitialAssessment)
   looking for objects that match a known scoring scale, then groups the
   hits by scale and renders a date · shift · total · risk table per scale
   so the bedside team can see trajectory at a glance. */
function ScoringTrendsSection({ nurseNotes = [], doctorNotes = [], currentAdmission }) {
  // All the heavy scanning/grouping is memoised on the inputs — large
  // patients with 200+ notes were paying this cost on every render.
  const byScale = useMemo(() => {
    const hits = [];
    const consider = (data, when, shift, by) => {
      if (!isMeaningful(data)) return;
      const direct = matchScale(data);
      if (direct) hits.push({ scaleId: direct.title, scale: direct, when, shift, by, data });
      if (typeof data === "object" && !Array.isArray(data)) {
        for (const v of Object.values(data)) {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            const nested = matchScale(v);
            if (nested) hits.push({ scaleId: nested.title, scale: nested, when, shift, by, data: v });
          }
        }
      }
    };
    for (const n of nurseNotes)  consider(n.noteData,    n.visitDate || n.noteDate || n.createdAt, n.shift, n.nurseName);
    for (const n of doctorNotes) consider(n.noteDetails, n.visitDate || n.createdAt, n.shift, n.doctorName);
    consider(currentAdmission?.nurseInitialAssessment, currentAdmission?.admissionDate, "admission", "Nurse");

    const grouped = {};
    for (const h of hits) {
      if (!grouped[h.scaleId]) grouped[h.scaleId] = { scale: h.scale, rows: [] };
      grouped[h.scaleId].rows.push(h);
    }
    for (const g of Object.values(grouped)) {
      g.rows.sort((a, b) => new Date(b.when) - new Date(a.when));
    }
    return grouped;
  }, [nurseNotes, doctorNotes, currentAdmission]);

  if (!Object.keys(byScale).length) return <Empty icon="📊" msg="No scoring scales recorded yet" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {Object.values(byScale).map(({ scale, rows }) => (
        <div key={scale.title} style={{
          padding: "8px 12px", borderRadius: 6,
          border: `1px solid ${scale.accent}30`, borderLeft: `4px solid ${scale.accent}`,
          background: "#fff",
        }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: scale.accent,
            textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
            {scale.title} <span style={{ fontWeight: 600, color: "var(--pf-muted)" }}>· {rows.length} entr{rows.length === 1 ? "y" : "ies"}</span>
          </div>
          <table className="pf-table pf-table--compact" style={{ width: "100%", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Date</th>
                <th style={{ textAlign: "left" }}>Shift</th>
                <th style={{ textAlign: "left" }}>By</th>
                {Object.keys(scale.items).map((code) => (
                  <th key={code} style={{ textAlign: "center", fontFamily: "monospace" }}>{code.toUpperCase()}</th>
                ))}
                <th style={{ textAlign: "center" }}>Total</th>
                <th style={{ textAlign: "left" }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const lookup = Object.fromEntries(
                  Object.entries(r.data).map(([k, v]) => [k.toLowerCase(), v]),
                );
                const itemKeys = Object.keys(scale.items);
                const values = itemKeys.map((c) => lookup[c.toLowerCase()]);
                const nums = values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
                const total = nums.length === itemKeys.length ? nums.reduce((a, b) => a + b, 0) : null;
                const interp = total != null && scale.interpret ? scale.interpret(total) : null;
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{fmtDate(r.when)}</td>
                    <td style={{ fontSize: 10.5, textTransform: "capitalize" }}>{r.shift || "—"}</td>
                    <td style={{ fontSize: 10.5 }}>{r.by || "—"}</td>
                    {values.map((v, j) => (
                      <td key={j} style={{ textAlign: "center", fontFamily: "monospace" }}>{v == null || v === "" ? "—" : v}</td>
                    ))}
                    <td style={{ textAlign: "center", fontWeight: 800, fontFamily: "monospace", color: interp?.color }}>{total == null ? "—" : total}</td>
                    <td>
                      {interp && (
                        <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: `${interp.color}15`, color: interp.color, border: `1px solid ${interp.color}40` }}>
                          {interp.risk}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ── Complete Timeline — every clinical event, grouped date → shift ─
   The "story view" of the patient's stay. Merges doctor notes, nurse
   notes, doctor orders, investigations, consents, diet plans, bed
   transfers, and the admission event itself into one sorted list,
   then renders date headers and shift sub-headers so the file reads
   chronologically. Each entry re-uses the existing NoteList / Section
   visual language. */
const SHIFT_ORDER = { morning: 0, afternoon: 1, evening: 2, night: 3, general: 4, "": 9 };
const dateKey = (d) => d ? new Date(d).toISOString().slice(0, 10) : "0000-00-00";

function TimelineSection({ data }) {
  const { byDate, dates, total } = useMemo(() => {
    const events = [];
    const push = (kind, title, when, shift, by, payload) =>
      when && events.push({ kind, title, when: new Date(when), shift: (shift || "").toLowerCase(), by, payload });

    for (const n of data.doctorNotes  || []) push("doctor-note", `Doctor — ${n.noteType || "note"}`, n.visitDate || n.createdAt, n.shift, n.doctorName, n);
    for (const n of data.nurseNotes   || []) push("nurse-note",  `Nurse — ${n.noteType || "note"}`,  n.visitDate || n.noteDate || n.createdAt, n.shift, n.nurseName, n);
    for (const o of data.doctorOrders || []) push("order",       `Order — ${o.orderDetails?.medicineName || o.orderType || "—"}`, o.orderedAt || o.createdAt, null, o.orderedBy || o.doctorName, o);
    for (const i of data.investigations || []) push("lab",       `Lab order — ${(i.items || []).length} test(s)`, i.createdAt, null, i.doctorName, i);
    for (const c of data.consents     || []) push("consent",     `Consent — ${c.consentTitle || c.consentType}`, c.createdAt, null, c.signedByName || c.consentGivenBy, c);
    for (const d of data.dietPlans    || []) push("diet",        `Diet plan — ${d.plan?.templateName || "Custom"}`, d.assignedAt || d.createdAt, null, d.assignedByName, d);
    for (const t of data.bedTransfers || []) push("transfer",    `Bed transfer — ${t.fromBed} → ${t.toBed}`, t.createdAt, null, t.requestedBy, t);
    for (const h of data.shiftHandovers || []) push("handover",  `Shift handover`, h.createdAt, h.shift, h.fromNurseName || h.byName, h);
    for (const m of data.mlc          || []) push("mlc",         `MLC — ${m.natureOfInjury || "report"}`, m.createdAt, null, m.doctorName, m);
    if (data.currentAdmission?.admissionDate) {
      push("admission", `Admission — ${data.currentAdmission.admissionType}`, data.currentAdmission.admissionDate, null, data.currentAdmission.createdBy, data.currentAdmission);
    }
    if (data.currentAdmission?.actualDischargeDate) {
      push("discharge", `Discharge`, data.currentAdmission.actualDischargeDate, null, data.currentAdmission.dischargedBy, data.currentAdmission);
    }
    if (data.dischargeSummary?.signedAt || data.dischargeSummary?.createdAt) {
      push("discharge-summary", "Discharge summary signed", data.dischargeSummary.signedAt || data.dischargeSummary.createdAt, null, data.dischargeSummary.signedByName, data.dischargeSummary);
    }

    const grouped = {};
    for (const e of events) {
      const k = dateKey(e.when);
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(e);
    }
    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    for (const k of sortedDates) {
      grouped[k].sort((a, b) => {
        const sa = SHIFT_ORDER[a.shift] ?? 9;
        const sb = SHIFT_ORDER[b.shift] ?? 9;
        if (sa !== sb) return sa - sb;
        return a.when - b.when;
      });
    }
    return { byDate: grouped, dates: sortedDates, total: events.length };
  }, [data]);

  if (!total) return <Empty icon="📜" msg="No events on file yet" />;

  const KIND_META = {
    "doctor-note":       { icon: "👨‍⚕️", color: "#7c3aed" },
    "nurse-note":        { icon: "👩‍⚕️", color: "#db2777" },
    "order":             { icon: "💊", color: "#ea580c" },
    "lab":               { icon: "🧪", color: "#0284c7" },
    "consent":           { icon: "📝", color: "#ca8a04" },
    "diet":              { icon: "🥗", color: "#16a34a" },
    "transfer":          { icon: "🛏",  color: "#0d9488" },
    "handover":          { icon: "🔄", color: "#0284c7" },
    "mlc":               { icon: "⚖",  color: "#dc2626" },
    "admission":         { icon: "🏥", color: "#2563eb" },
    "discharge":         { icon: "🚪", color: "#0d9488" },
    "discharge-summary": { icon: "📄", color: "#0d9488" },
  };

  return (
    <div className="pf-timeline">
      {dates.map((dk) => {
        const date = new Date(byDate[dk][0].when);
        const dateStr = date.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
        // Group within date by shift label for sub-headers.
        const byShift = {};
        for (const e of byDate[dk]) {
          const sk = e.shift || "general";
          if (!byShift[sk]) byShift[sk] = [];
          byShift[sk].push(e);
        }
        const shifts = Object.keys(byShift).sort((a, b) => (SHIFT_ORDER[a] ?? 9) - (SHIFT_ORDER[b] ?? 9));
        return (
          <div key={dk} className="pf-date-card" style={{ marginBottom: 14 }}>
            <div style={{
              position: "sticky", top: 0, zIndex: 1, background: "#fff",
              padding: "6px 10px", borderRadius: 6,
              border: "1px solid #c7d2fe", borderLeft: "4px solid #4f46e5",
              marginBottom: 6, fontSize: 12.5, fontWeight: 800, color: "#3730a3",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>📅 {dateStr}</span>
              <span style={{ fontSize: 10.5, color: "var(--pf-muted)", fontWeight: 600 }}>{byDate[dk].length} event{byDate[dk].length !== 1 ? "s" : ""}</span>
            </div>
            {shifts.map((sk) => (
              <div key={sk} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--pf-muted)",
                  textTransform: "uppercase", letterSpacing: 0.6, margin: "4px 0 4px 8px" }}>
                  Shift: {sk}
                </div>
                <div style={{ paddingLeft: 8, borderLeft: "2px dashed #e5e7eb", display: "flex", flexDirection: "column", gap: 4 }}>
                  {byShift[sk].map((e, i) => {
                    const meta = KIND_META[e.kind] || { icon: "•", color: "#64748b" };
                    return (
                      <div key={i} style={{
                        display: "grid", gridTemplateColumns: "55px 18px 1fr", gap: 8,
                        padding: "4px 8px", borderRadius: 4,
                        border: `1px solid ${meta.color}20`, background: "#fff",
                        borderLeft: `3px solid ${meta.color}`,
                        alignItems: "baseline",
                      }}>
                        <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--pf-muted)" }}>
                          {e.when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span style={{ fontSize: 12 }}>{meta.icon}</span>
                        <span style={{ fontSize: 11.5 }}>
                          <b style={{ color: meta.color }}>{e.title}</b>
                          {e.by && <span style={{ color: "var(--pf-muted)" }}> · {e.by}</span>}
                          {e.payload?.status && <span style={{ marginLeft: 6, padding: "0 6px", borderRadius: 3, fontSize: 9.5, fontWeight: 700,
                            background: "#f1f5f9", color: "var(--pf-muted)" }}>{e.payload.status}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ── Intake / Output Sheet ──────────────────────────────────────────
   Pulls every I/O entry from across all nurse notes (and the admission's
   nurseInitialAssessment if it carried any) and renders the classic ICU
   I/O chart grouped by date → shift, with daily totals + running net
   balance so the dietician / doctor / nurse can read fluid balance at a
   glance. */
const IO_INTAKE_KEYS = ["oral", "ivFluids", "bloodProducts"];
const IO_OUTPUT_KEYS = ["urineOutput", "drainOutput", "nasogastric", "emesis", "bloodLoss"];
const IO_INTAKE_LABELS = { oral: "Oral", ivFluids: "IV fluids", bloodProducts: "Blood prod." };
const IO_OUTPUT_LABELS = { urineOutput: "Urine", drainOutput: "Drain", nasogastric: "NGT", emesis: "Emesis", bloodLoss: "Blood loss" };
const IO_ALL_KEYS = [...IO_INTAKE_KEYS, ...IO_OUTPUT_KEYS];
const ioNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function ioRowFrom(noteData) {
  if (!noteData || typeof noteData !== "object") return null;
  const row = {};
  let any = false;
  // Direct fields on noteData
  for (const k of IO_ALL_KEYS) {
    if (noteData[k] != null && noteData[k] !== "") { row[k] = ioNumber(noteData[k]); any = any || row[k] > 0; }
  }
  // Also check nested intakeOutput shape (some forms store it as a sub-object)
  const io = noteData.intakeOutput || noteData.io;
  if (io && typeof io === "object") {
    for (const k of IO_ALL_KEYS) {
      if (io[k] != null && io[k] !== "") {
        const n = ioNumber(io[k]);
        if (!row[k]) row[k] = n;
        any = any || n > 0;
      }
    }
    if (io.notes) row._notes = io.notes;
  }
  if (noteData.notes && !row._notes) row._notes = noteData.notes;
  return any ? row : null;
}

function IOSheetSection({ nurseNotes = [], currentAdmission }) {
  const { byDate, dateKeys, hasAny } = useMemo(() => {
    const events = [];
    for (const n of nurseNotes) {
      const row = ioRowFrom(n.noteData);
      if (!row) continue;
      const when = n.visitDate || n.noteDate || n.createdAt;
      if (!when) continue; // skip events with no usable timestamp
      events.push({
        when: new Date(when),
        shift: (n.shift || "general").toLowerCase(),
        by: n.nurseName || "—",
        noteType: n.noteType,
        row,
      });
    }
    const iaRow = ioRowFrom(currentAdmission?.nurseInitialAssessment);
    if (iaRow && currentAdmission?.admissionDate) {
      events.push({
        when: new Date(currentAdmission.admissionDate),
        shift: "admission", by: "Nurse (IA)", noteType: "initial", row: iaRow,
      });
    }
    const grouped = {};
    for (const e of events) {
      const dk = dateKey(e.when);
      if (!grouped[dk]) grouped[dk] = { date: e.when, byShift: {} };
      const sk = e.shift || "general";
      if (!grouped[dk].byShift[sk]) grouped[dk].byShift[sk] = [];
      grouped[dk].byShift[sk].push(e);
    }
    const keys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    for (const dk of keys) {
      for (const sk of Object.keys(grouped[dk].byShift)) {
        grouped[dk].byShift[sk].sort((a, b) => a.when - b.when);
      }
    }
    return { byDate: grouped, dateKeys: keys, hasAny: events.length > 0 };
  }, [nurseNotes, currentAdmission]);

  if (!hasAny) return <Empty icon="💧" msg="No intake / output recorded yet" />;

  // Aggregate totals helper
  const sumRows = (rows) => {
    const tot = { in: 0, out: 0, parts: {} };
    for (const e of rows) {
      for (const k of IO_INTAKE_KEYS) {
        const v = e.row[k] || 0;
        tot.in += v;
        tot.parts[k] = (tot.parts[k] || 0) + v;
      }
      for (const k of IO_OUTPUT_KEYS) {
        const v = e.row[k] || 0;
        tot.out += v;
        tot.parts[k] = (tot.parts[k] || 0) + v;
      }
    }
    return tot;
  };

  const TH = { padding: "4px 6px", textAlign: "right", fontSize: 10, fontWeight: 800, color: "var(--pf-muted)", textTransform: "uppercase", letterSpacing: 0.4 };
  const TD = { padding: "3px 6px", textAlign: "right", fontFamily: "monospace", fontSize: 11 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {dateKeys.map((dk) => {
        const dayEntries = Object.values(byDate[dk].byShift).flat();
        const dayTotals = sumRows(dayEntries);
        const dayNet = dayTotals.in - dayTotals.out;
        const netColor = dayNet > 500 ? "#ca8a04" : dayNet < -500 ? "#dc2626" : "#16a34a";
        const date = byDate[dk].date;
        const shifts = Object.keys(byDate[dk].byShift).sort((a, b) => (SHIFT_ORDER[a] ?? 9) - (SHIFT_ORDER[b] ?? 9));

        return (
          <div key={dk} className="pf-date-card" style={{ border: "1px solid #99f6e4", borderRadius: 6, borderLeft: "4px solid #0d9488", overflow: "hidden", marginBottom: 12 }}>
            <div style={{
              padding: "6px 12px", background: "linear-gradient(90deg, #ecfdf5 0%, #fff 60%)",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6,
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f766e" }}>
                📅 {date.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 800, background: "#dcfce7", color: "#166534" }}>IN: {dayTotals.in} ml</span>
                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 800, background: "#fee2e2", color: "#b91c1c" }}>OUT: {dayTotals.out} ml</span>
                <span
                  aria-label={dayNet > 500 ? "Net fluid overload (>+500 ml)" : dayNet < -500 ? "Net fluid deficit (<-500 ml)" : "Net fluid balance OK"}
                  style={{ padding: "2px 10px", borderRadius: 4, fontSize: 11.5, fontWeight: 800,
                  background: `${netColor}18`, color: netColor, border: `1px solid ${netColor}50` }}>
                  NET: {dayNet >= 0 ? "+" : ""}{dayNet} ml
                </span>
              </div>
            </div>

            {shifts.map((sk) => {
              const rows = byDate[dk].byShift[sk];
              const t = sumRows(rows);
              const sNet = t.in - t.out;
              return (
                <div key={sk} style={{ padding: "6px 10px", borderTop: "1px dashed #99f6e4" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                    Shift: {sk} <span style={{ color: "var(--pf-muted)", fontWeight: 600 }}>· {rows.length} entr{rows.length === 1 ? "y" : "ies"}</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="pf-table pf-table--compact" style={{ width: "100%", minWidth: 720 }}>
                      <thead>
                        <tr>
                          <th style={{ ...TH, textAlign: "left" }}>Time</th>
                          {IO_INTAKE_KEYS.map((k) => <th key={k} style={TH}>{IO_INTAKE_LABELS[k]}</th>)}
                          {IO_OUTPUT_KEYS.map((k) => <th key={k} style={TH}>{IO_OUTPUT_LABELS[k]}</th>)}
                          <th style={TH}>Net</th>
                          <th style={{ ...TH, textAlign: "left" }}>Notes</th>
                          <th style={{ ...TH, textAlign: "left" }}>By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((e, i) => {
                          const rIn  = IO_INTAKE_KEYS.reduce((s, k) => s + (e.row[k] || 0), 0);
                          const rOut = IO_OUTPUT_KEYS.reduce((s, k) => s + (e.row[k] || 0), 0);
                          const rNet = rIn - rOut;
                          return (
                            <tr key={i}>
                              <td style={{ ...TD, textAlign: "left" }}>{e.when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                              {IO_INTAKE_KEYS.map((k) => <td key={k} style={{ ...TD, color: e.row[k] ? "#15803d" : "#cbd5e1" }}>{e.row[k] || "—"}</td>)}
                              {IO_OUTPUT_KEYS.map((k) => <td key={k} style={{ ...TD, color: e.row[k] ? "#b91c1c" : "#cbd5e1" }}>{e.row[k] || "—"}</td>)}
                              <td style={{ ...TD, fontWeight: 800, color: rNet > 0 ? "#15803d" : rNet < 0 ? "#b91c1c" : "#64748b" }}>{rNet >= 0 ? "+" : ""}{rNet}</td>
                              <td style={{ ...TD, textAlign: "left", fontFamily: "system-ui", fontStyle: e.row._notes ? "normal" : "italic", color: e.row._notes ? "inherit" : "#cbd5e1" }}>
                                {e.row._notes || "—"}
                              </td>
                              <td style={{ ...TD, textAlign: "left", fontFamily: "system-ui", fontSize: 10.5, color: "var(--pf-muted)" }}>{e.by}</td>
                            </tr>
                          );
                        })}
                        <tr style={{ background: "#f0fdfa", fontWeight: 800 }}>
                          <td style={{ ...TD, textAlign: "left", fontFamily: "system-ui", fontSize: 10.5, color: "#0f766e", textTransform: "uppercase", letterSpacing: 0.4 }}>Shift totals</td>
                          {IO_INTAKE_KEYS.map((k) => <td key={k} style={{ ...TD, color: "#15803d" }}>{t.parts[k] || "—"}</td>)}
                          {IO_OUTPUT_KEYS.map((k) => <td key={k} style={{ ...TD, color: "#b91c1c" }}>{t.parts[k] || "—"}</td>)}
                          <td style={{ ...TD, color: sNet >= 0 ? "#15803d" : "#b91c1c" }}>{sNet >= 0 ? "+" : ""}{sNet}</td>
                          <td style={{ ...TD, textAlign: "left", fontFamily: "system-ui", fontSize: 10.5, color: "#0f766e" }}>
                            In: <b>{t.in}</b> ml · Out: <b>{t.out}</b> ml
                          </td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ── Procedure Notes — combined Doctor + Nurse procedure records ──
   Pulls every note where noteType matches /procedure/ AND/OR the
   payload signature matches matchProcedure(). Groups date → shift,
   each entry rendered with the same <ProcedurePanel/> the inline
   note cards already use. Print-ready chronological view. */
function ProcedureNotesSection({ doctorNotes = [], nurseNotes = [] }) {
  const { byDate, dates, totalCount, doctorCount, nurseCount } = useMemo(() => {
    const PROC_TYPES = /procedure|operative|preop|postop/i;
    const arr = [];
    for (const n of doctorNotes) {
      const looksProc = PROC_TYPES.test(n.noteType || "") || matchProcedure(n.noteDetails);
      if (!looksProc) continue;
      const when = n.visitDate || n.createdAt;
      if (!when) continue;
      const payload = isMeaningful(n.noteDetails) ? n.noteDetails : {
        procedureName: n.noteType, indication: n.provisionalDiagnosis, outcome: n.patientStatus,
      };
      arr.push({
        when: new Date(when),
        shift: (n.shift || "general").toLowerCase(),
        by: n.doctorName || "Doctor", role: "Doctor", noteType: n.noteType,
        remarks: n.remarks || n.note || "", payload,
        signedBy: n.signedByName, signedAt: n.signedAt, status: n.status,
      });
    }
    for (const n of nurseNotes) {
      const looksProc = PROC_TYPES.test(n.noteType || "") || matchProcedure(n.noteData);
      if (!looksProc) continue;
      const when = n.visitDate || n.noteDate || n.createdAt;
      if (!when) continue;
      arr.push({
        when: new Date(when),
        shift: (n.shift || "general").toLowerCase(),
        by: n.nurseName || "Nurse", role: "Nurse", noteType: n.noteType,
        remarks: n.remarks || "", payload: n.noteData,
        signedBy: n.signedByName, signedAt: n.submittedAt, status: n.status,
      });
    }
    const grouped = {};
    for (const e of arr) {
      const dk = dateKey(e.when);
      if (!grouped[dk]) grouped[dk] = { date: e.when, byShift: {} };
      const sk = e.shift || "general";
      if (!grouped[dk].byShift[sk]) grouped[dk].byShift[sk] = [];
      grouped[dk].byShift[sk].push(e);
    }
    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    for (const dk of sortedDates) {
      for (const sk of Object.keys(grouped[dk].byShift)) {
        grouped[dk].byShift[sk].sort((a, b) => a.when - b.when);
      }
    }
    const dCount = arr.filter((e) => e.role === "Doctor").length;
    return { byDate: grouped, dates: sortedDates, totalCount: arr.length, doctorCount: dCount, nurseCount: arr.length - dCount };
  }, [doctorNotes, nurseNotes]);

  if (!totalCount) return <Empty icon="🩺" msg="No procedure notes recorded yet" />;

  return (
    <>
      <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{ padding: "2px 9px", borderRadius: 4, fontSize: 11, fontWeight: 800,
          background: "#dcfce7", color: "#166534" }}>Total: {totalCount}</span>
        {doctorCount > 0 && <span style={{ padding: "2px 9px", borderRadius: 4, fontSize: 11, fontWeight: 800,
          background: "#f3e8ff", color: "#7c3aed" }}>👨‍⚕️ Doctor: {doctorCount}</span>}
        {nurseCount > 0 && <span style={{ padding: "2px 9px", borderRadius: 4, fontSize: 11, fontWeight: 800,
          background: "#fce7f3", color: "#db2777" }}>👩‍⚕️ Nurse: {nurseCount}</span>}
      </div>

      {dates.map((dk) => {
        const date = byDate[dk].date;
        const dateStr = date.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
        const shifts = Object.keys(byDate[dk].byShift).sort((a, b) => (SHIFT_ORDER[a] ?? 9) - (SHIFT_ORDER[b] ?? 9));
        const dayCount = Object.values(byDate[dk].byShift).reduce((s, arr) => s + arr.length, 0);
        return (
          <div key={dk} className="pf-date-card" style={{ marginBottom: 14 }}>
            <div style={{
              padding: "6px 12px", borderRadius: 6, marginBottom: 6,
              border: "1px solid #bbf7d0", borderLeft: "4px solid #16a34a",
              background: "linear-gradient(90deg, #f0fdf4 0%, #fff 60%)",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "#166534" }}>📅 {dateStr}</span>
              <span style={{ fontSize: 10.5, color: "var(--pf-muted)", fontWeight: 700 }}>{dayCount} procedure note{dayCount !== 1 ? "s" : ""}</span>
            </div>
            {shifts.map((sk) => (
              <div key={sk} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--pf-muted)",
                  textTransform: "uppercase", letterSpacing: 0.6, margin: "4px 0 4px 8px" }}>
                  Shift: {sk}
                </div>
                <div style={{ paddingLeft: 8, borderLeft: "2px dashed #e5e7eb", display: "flex", flexDirection: "column", gap: 4 }}>
                  {byDate[dk].byShift[sk].map((e, i) => {
                    const roleColor = e.role === "Doctor" ? "#7c3aed" : "#db2777";
                    return (
                      <div key={i} style={{
                        padding: "6px 10px", borderRadius: 5,
                        background: "#fff", border: "1px solid #e5e7eb",
                        borderLeft: `3px solid ${roleColor}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--pf-muted)" }}>
                            {e.when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span style={{ padding: "1px 7px", borderRadius: 3, fontSize: 10, fontWeight: 800,
                            background: `${roleColor}15`, color: roleColor }}>
                            {e.role === "Doctor" ? "👨‍⚕️ DOCTOR" : "👩‍⚕️ NURSE"}
                          </span>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#1f2937" }}>{e.by}</span>
                          {e.noteType && <span style={{ fontSize: 10.5, color: "var(--pf-muted)" }}>· {e.noteType}</span>}
                          {e.status && <span style={{ marginLeft: "auto", padding: "1px 7px", borderRadius: 3, fontSize: 9.5, fontWeight: 700,
                            background: ["signed", "submitted"].includes(e.status) ? "#dcfce7" : "#fef3c7",
                            color:      ["signed", "submitted"].includes(e.status) ? "#166534" : "#92400e" }}>
                            {e.status}
                          </span>}
                        </div>
                        {/* Re-use the existing ProcedurePanel for any payload that matches; fall back to generic chips otherwise */}
                        {isMeaningful(e.payload) && (
                          matchProcedure(e.payload)
                            ? <ProcedurePanel data={e.payload} />
                            : <MixedFields data={e.payload} />
                        )}
                        {e.remarks && <div style={{ marginTop: 4, fontSize: 11, fontStyle: "italic", color: "var(--pf-muted)" }}>{e.remarks}</div>}
                        {e.signedBy && <div style={{ marginTop: 3, fontSize: 10, color: "var(--pf-muted)" }}>
                          Signed by {e.signedBy}{e.signedAt ? ` on ${fmtDT(e.signedAt)}` : ""}
                        </div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function PrintFooter({ uhid, role, hs = {} }) {
  // Roadmap F23 — per-page QR back-link. The browser repeats this footer
  // via @page running-element on every printed page, so any single page
  // photographed in isolation still links back to the live source.
  const qrUrl = uhid
    ? `https://api.qrserver.com/v1/create-qr-code/?size=80x80&margin=2&data=${encodeURIComponent(
        `${typeof window !== "undefined" ? window.location.origin : ""}/patient-file/${uhid}?role=${role}`
      )}`
    : null;
  // R7cb-B: institution claim pulled from Settings.hospitalName so admin's
  // rebrand reaches the patient file footer.
  const hospName = hs.hospitalName || "Hospital";
  return (
    <footer className="pf-print-footer">
      {qrUrl && <img src={qrUrl} alt={`Verify online — UHID ${uhid}`} className="pf-print-footer__qr" />}
      <div style={{ flex: 1 }}>
        <div>© {hospName} · Computer-generated medical record · NABH AAC.7</div>
        <div style={{ fontSize: 9, opacity: .7, marginTop: 2 }}>
          PDF/A-2b archival — embed fonts via printer. Verify printed copy by scanning QR or visiting
          /patient-file/{uhid}
        </div>
      </div>
      <span>Printed {new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
    </footer>
  );
}

/* ──────────────────────────────────────────────────────────────
   R7k — Nursing-record sections previously fetched-but-never-rendered.
   The patient-file backend has always returned `nursingCarePlans` +
   `nursingAssessments`, but the file UI never consumed them, so a
   nurse who saved a Daily Assessment / Nutrition / Patient Education
   / Care Plan would find their work missing from the file view AND
   from the print. These three lightweight read-only sections close
   that NABH-compliance gap.
─────────────────────────────────────────────────────────────── */

function CarePlansSection({ carePlans = [] }) {
  if (!carePlans.length) return <Empty icon="📋" msg="No nursing care plans on file" />;
  // Newest first — most clinically actionable plan is usually the latest
  const sorted = [...carePlans].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {sorted.map((p) => {
        const diags = Array.isArray(p.diagnoses) ? p.diagnoses
                    : Array.isArray(p.problems) ? p.problems
                    : (p.diagnosis || p.problem) ? [p.diagnosis || p.problem]
                    : [];
        const interventions = Array.isArray(p.interventions) ? p.interventions
                            : p.intervention ? [p.intervention]
                            : [];
        const outcomes = Array.isArray(p.outcomes) ? p.outcomes
                       : p.outcome ? [p.outcome]
                       : [];
        return (
          <div key={p._id} className="pf-record pf-record--nurse">
            <div className="pf-record__head">
              <span className="pf-record__title">
                Care plan {p.shift ? `· ${p.shift}` : ""}
              </span>
              <span className="pf-record__time">{fmtDT(p.createdAt)}</span>
              <span className="pf-record__by">by {p.nurseName || p.createdByName || "Nurse"}</span>
            </div>
            <div className="pf-record__body">
              {diags.length > 0 && (
                <p><strong>Problems / Nursing diagnoses:</strong> {diags.filter(Boolean).join(" · ")}</p>
              )}
              {p.goal && <p><strong>Goal:</strong> {p.goal}</p>}
              {interventions.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <strong>Interventions:</strong>
                  <ul style={{ margin: "2px 0 0 18px", padding: 0, fontSize: 12.5 }}>
                    {interventions.filter(Boolean).map((it, i) => (
                      <li key={i}>{typeof it === "string" ? it : (it?.text || JSON.stringify(it))}</li>
                    ))}
                  </ul>
                </div>
              )}
              {outcomes.length > 0 && (
                <p style={{ marginTop: 4 }}>
                  <strong>Expected outcomes:</strong> {outcomes.filter(Boolean).map(o => typeof o === "string" ? o : (o?.text || "")).join(" · ")}
                </p>
              )}
              {p.evaluation && <p><strong>Evaluation:</strong> {p.evaluation}</p>}
              {p.notes && <p style={{ color: "var(--pf-muted)" }}>{p.notes}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NursingAssessmentsSection({ assessments = [] }) {
  // Group by type (daily / nutrition / education / etc) so each subsection
  // is easy to scan independently. Daily assessments are usually 1-per-day,
  // nutrition/education tend to be single-shot.
  const groups = useMemo(() => {
    const g = { nutrition: [], education: [], daily: [], other: [] };
    for (const a of assessments) {
      const t = String(a.type || "").toLowerCase();
      if (t === "nutrition")     g.nutrition.push(a);
      else if (t === "education") g.education.push(a);
      else if (t === "daily")     g.daily.push(a);
      else                        g.other.push(a);
    }
    // newest first within each group
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return g;
  }, [assessments]);

  const total = assessments.length;
  if (!total) return <Empty icon="📑" msg="No nutrition / patient-education / daily assessments on file" />;

  const renderEntry = (a, label) => {
    const d = a.data || {};
    const fields = Object.entries(d).filter(([k, v]) =>
      v != null && v !== "" && !(typeof v === "object" && Object.keys(v).length === 0));
    return (
      <div key={a._id} className="pf-record pf-record--nurse" style={{ marginBottom: 8 }}>
        <div className="pf-record__head">
          <span className="pf-record__title">{label}</span>
          <span className="pf-record__time">{fmtDT(a.createdAt)}</span>
          <span className="pf-record__by">by {a.nurseName || a.createdByName || "Nurse"}</span>
        </div>
        <div className="pf-record__body">
          {fields.length === 0 ? (
            <p style={{ color: "var(--pf-muted)" }}>(no fields recorded)</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "2px 14px", fontSize: 12.5 }}>
              {fields.map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: "var(--pf-muted)", fontWeight: 700 }}>{k}:</span>{" "}
                  <span>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          )}
          {a.notes && <p style={{ marginTop: 6, fontStyle: "italic", color: "var(--pf-muted)" }}>{a.notes}</p>}
        </div>
      </div>
    );
  };

  return (
    <div>
      {groups.nutrition.length > 0 && (
        <>
          <h4 style={{ margin: "0 0 6px", color: "var(--pf-accent-d)" }}>🥗 Nutritional Assessment</h4>
          {groups.nutrition.map((a) => renderEntry(a, "Nutritional assessment"))}
        </>
      )}
      {groups.education.length > 0 && (
        <>
          <h4 style={{ margin: "10px 0 6px", color: "var(--pf-accent-d)" }}>📘 Patient Education</h4>
          {groups.education.map((a) => renderEntry(a, "Patient-education session"))}
        </>
      )}
      {groups.daily.length > 0 && (
        <>
          <h4 style={{ margin: "10px 0 6px", color: "var(--pf-accent-d)" }}>🩺 Daily Nursing Assessment</h4>
          {groups.daily.map((a) => renderEntry(a, "Daily nursing assessment"))}
        </>
      )}
      {groups.other.length > 0 && (
        <>
          <h4 style={{ margin: "10px 0 6px", color: "var(--pf-accent-d)" }}>📝 Other nursing assessments</h4>
          {groups.other.map((a) => renderEntry(a, a.type || "Nursing assessment"))}
        </>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   R7l — Day-wise Treatment Chart for the printed file.
   The interactive view shows a live MAR via <TreatmentChart>; that
   component is interactive (administer buttons, modals, filters)
   and won't paginate cleanly. For PRINT we render a static
   day-by-day medication chart pulled from DoctorOrder.administrationRecord
   (the canonical NABH MAR — same source TreatmentChart writes to).
   For a 3-day stay we render 3 day-blocks aligned chronologically;
   inside each day every medication shows its scheduled doses with a
   green ✓ when administered + the nurse name + actual time.
─────────────────────────────────────────────────────────────── */
function TreatmentChartPrintSection({ doctorOrders = [], currentAdmission, icuBundles = [] }) {
  // R7eg2 — Per-day ICU bundle summary lookup: groups all bundle sheets
  // by their date string (YYYY-MM-DD) and, for each date, lists which
  // bundle/shift combinations were FINALIZED. The day-wise treatment
  // chart renders a footer per day showing e.g. "VAP: ✓ M,E · CAUTI: ✓ M".
  // Built once per re-render and indexed via dateKey for O(1) lookup.
  const bundlesByDate = useMemo(() => {
    const SHIFT_ABBR = { Morning: "M", Evening: "E", Night: "N" };
    const BUNDLE_KEYS = ["vap", "cauti", "clabsi", "dvt", "sepsis", "sup"];
    const out = {};
    for (const sheet of icuBundles || []) {
      if (!sheet?.date) continue;
      if (sheet.status !== "finalized") continue; // only count signed sheets
      const day = (out[sheet.date] = out[sheet.date] || {});
      // sheet.bundles is the unwrapped array we built in the backend; fall
      // back to the legacy flat keys (vap/cauti/...) if a future caller
      // sends the model shape instead.
      const arr = Array.isArray(sheet.bundles)
        ? sheet.bundles
        : BUNDLE_KEYS.map((k) => ({ key: k, ...(sheet[k] || {}) }));
      for (const b of arr) {
        if (!b?.key) continue;
        if (b.applicable === false) continue;
        const bucket = (day[b.key] = day[b.key] || { shifts: [], applicable: true });
        const ab = SHIFT_ABBR[sheet.shift] || sheet.shift?.[0] || "?";
        if (!bucket.shifts.includes(ab)) bucket.shifts.push(ab);
      }
    }
    // Sort shifts canonically M → E → N within each (date, bundle).
    const ORDER = { M: 0, E: 1, N: 2 };
    for (const day of Object.values(out)) {
      for (const b of Object.values(day)) {
        b.shifts.sort((x, y) => (ORDER[x] ?? 9) - (ORDER[y] ?? 9));
      }
    }
    return out;
  }, [icuBundles]);

  const data = useMemo(() => {
    // Pull only Medication / IV-Fluid / Blood orders — those are what
    // populate the MAR. Other orderTypes (Lab / Radiology / Procedure)
    // belong in their own sections.
    const MAR_TYPES = new Set(["Medication", "IV_Fluid", "BloodTransfusion", "Oxygen"]);
    const meds = (doctorOrders || []).filter((o) => MAR_TYPES.has(o.orderType));
    if (meds.length === 0) return { days: [], hasAny: false };

    // Anchor: admission start → today (or actualDischargeDate if discharged).
    // We bucket each administration by the LOCAL day of givenAt / scheduledDate.
    const startMs = currentAdmission?.admissionDate
      ? new Date(currentAdmission.admissionDate).getTime()
      : (() => {
          // No admission date — fall back to the earliest ordered/given timestamp.
          let earliest = Infinity;
          for (const o of meds) {
            const t = new Date(o.orderedAt || o.createdAt).getTime();
            if (Number.isFinite(t) && t < earliest) earliest = t;
            for (const a of (o.administrationRecord || [])) {
              const at = new Date(a.givenAt || a.scheduledDate || 0).getTime();
              if (Number.isFinite(at) && at < earliest) earliest = at;
            }
          }
          return Number.isFinite(earliest) ? earliest : Date.now();
        })();
    const endMs = (currentAdmission?.actualDischargeDate
      ? new Date(currentAdmission.actualDischargeDate).getTime()
      : Date.now());

    const dayMs = 24 * 60 * 60 * 1000;
    const startDay = new Date(startMs); startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(endMs); endDay.setHours(0, 0, 0, 0);
    const dayList = [];
    for (let t = startDay.getTime(); t <= endDay.getTime(); t += dayMs) {
      dayList.push(new Date(t));
    }
    // Safety: cap at 60 days so a degenerate admissionDate doesn't print
    // a thousand-page document. NABH inpatient stays >60d are exceptional
    // and would warrant separate runs anyway.
    if (dayList.length > 60) dayList.length = 60;

    // Per-medication per-day administration map:
    //   meds = [{ med, perDay: Map<dateKey, [adminEntries]> }, …]
    const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const enriched = meds.map((o) => {
      const perDay = {};
      for (const a of (o.administrationRecord || [])) {
        const when = a.givenAt || a.scheduledDate;
        if (!when) continue;
        const d = new Date(when); d.setHours(0, 0, 0, 0);
        const k = dk(d);
        if (!perDay[k]) perDay[k] = [];
        perDay[k].push(a);
      }
      return { order: o, perDay };
    });

    // Build day-blocks. For each day, list every order that was either
    // active on that day OR has an administration on that day. An order
    // is "active on a day" if startDate ≤ day ≤ (endDate || ∞).
    const days = dayList.map((d) => {
      const dayKey = dk(d);
      const dayStart = d.getTime();
      const dayEnd = dayStart + dayMs - 1;
      const rows = [];
      for (const { order, perDay } of enriched) {
        const orderStart = new Date(order.orderedAt || order.createdAt || 0).getTime();
        const orderEndRaw = order.endDate || order.discontinuedAt || null;
        const orderEnd = orderEndRaw ? new Date(orderEndRaw).getTime() : Infinity;
        const active = orderStart <= dayEnd && orderEnd >= dayStart;
        const admins = perDay[dayKey] || [];
        if (!active && admins.length === 0) continue;
        rows.push({ order, admins });
      }
      return { date: d, rows };
    }).filter((d) => d.rows.length > 0);

    return { days, hasAny: days.length > 0 };
  }, [doctorOrders, currentAdmission]);

  if (!data.hasAny) {
    return <Empty icon="💊" msg="No medication / IV / oxygen orders on file" />;
  }

  const fmtTime = (when) => when
    ? new Date(when).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "—";
  const fmtDateLong = (d) =>
    d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  const TH_STYLE = { padding: "4px 8px", textAlign: "left", fontSize: 10, fontWeight: 800, color: "var(--pf-muted)", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1.5px solid #e2e8f0", background: "#f8fafc" };
  const TD_STYLE = { padding: "5px 8px", fontSize: 11, verticalAlign: "top", borderBottom: "1px dashed #e2e8f0" };

  // Per-status pill renderer — green tick for given, amber/red for
  // hold/refused/skipped, neutral dash for pending.
  const renderDoseChip = (a) => {
    const s = (a.status || "pending").toLowerCase();
    const time = fmtTime(a.givenAt);
    if (s === "given") {
      return (
        <div style={{ display: "inline-flex", flexDirection: "column", marginRight: 10, marginBottom: 4 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, background: "#dcfce7", color: "#166534", fontWeight: 800, fontSize: 10.5, border: "1px solid #86efac" }}>
            ✓ {a.scheduledTime || time}
          </span>
          <span style={{ fontSize: 9.5, color: "var(--pf-muted)", marginTop: 2 }}>
            {a.givenBy || "Nurse"} @ {time}
          </span>
        </div>
      );
    }
    const palette = s === "hold"          ? { bg: "#fef3c7", fg: "#92400e", bd: "#fcd34d", icon: "⏸", label: "HOLD" }
                  : s === "refused"       ? { bg: "#fee2e2", fg: "#b91c1c", bd: "#fca5a5", icon: "✗", label: "REFUSED" }
                  : s === "skipped"       ? { bg: "#fee2e2", fg: "#b91c1c", bd: "#fca5a5", icon: "✗", label: "SKIPPED" }
                  : s === "not_available" ? { bg: "#fef3c7", fg: "#92400e", bd: "#fcd34d", icon: "⚠", label: "N/A" }
                  : s === "delayed"       ? { bg: "#fef3c7", fg: "#92400e", bd: "#fcd34d", icon: "⏱", label: "DELAYED" }
                  : s === "partial"       ? { bg: "#dbeafe", fg: "#1e40af", bd: "#93c5fd", icon: "◐", label: "PARTIAL" }
                  :                         { bg: "#f1f5f9", fg: "#475569", bd: "#cbd5e1", icon: "○", label: "PENDING" };
    return (
      <div style={{ display: "inline-flex", flexDirection: "column", marginRight: 10, marginBottom: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, background: palette.bg, color: palette.fg, fontWeight: 800, fontSize: 10.5, border: `1px solid ${palette.bd}` }}>
          {palette.icon} {a.scheduledTime || "—"}
        </span>
        <span style={{ fontSize: 9.5, color: "var(--pf-muted)", marginTop: 2 }}>
          {palette.label}{a.givenBy ? ` · ${a.givenBy}` : ""}
        </span>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 11, color: "var(--pf-muted)", marginBottom: -6 }}>
        NABH MOM.3 — every scheduled dose with administration status (✓ given · ⏸ hold · ✗ refused/skipped · ⏱ delayed · ◐ partial · ○ pending).
        Patient stay: <b>{data.days.length} day{data.days.length === 1 ? "" : "s"}</b>.
      </div>
      {data.days.map((day, idx) => {
        const dayNum = idx + 1;
        const totalDosesGiven = day.rows.reduce((s, r) => s + r.admins.filter(a => (a.status || "").toLowerCase() === "given").length, 0);
        const totalDosesAll   = day.rows.reduce((s, r) => s + r.admins.length, 0);
        return (
          <div key={day.date.toISOString()} style={{
            border: "1px solid #c7d2fe", borderLeft: "4px solid #4f46e5",
            borderRadius: 6, overflow: "hidden", pageBreakInside: "avoid",
          }}>
            <div style={{
              padding: "6px 12px",
              background: "linear-gradient(90deg, #eef2ff 0%, #fff 60%)",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6,
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "#3730a3" }}>
                📅 Day {dayNum} — {fmtDateLong(day.date)}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 10.5 }}>
                <span style={{ padding: "2px 8px", borderRadius: 4, fontWeight: 800, background: "#dcfce7", color: "#166534" }}>
                  ✓ Given: {totalDosesGiven}
                </span>
                {totalDosesAll - totalDosesGiven > 0 && (
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontWeight: 800, background: "#fef3c7", color: "#92400e" }}>
                    Pending/Other: {totalDosesAll - totalDosesGiven}
                  </span>
                )}
                <span style={{ padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: "#f1f5f9", color: "var(--pf-muted)" }}>
                  {day.rows.length} med{day.rows.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...TH_STYLE, width: "26%" }}>Medication</th>
                  <th style={{ ...TH_STYLE, width: "16%" }}>Dose · Route</th>
                  <th style={{ ...TH_STYLE, width: "12%" }}>Frequency</th>
                  <th style={{ ...TH_STYLE, width: "14%" }}>Ordered by</th>
                  <th style={TH_STYLE}>Doses administered (status · scheduled-time · nurse @ actual-time)</th>
                </tr>
              </thead>
              <tbody>
                {day.rows.map(({ order, admins }) => {
                  const od = order.orderDetails || {};
                  const med = od.medicineName || od.displayName || order.orderType;
                  const dose = od.dose || "—";
                  const route = od.route || "";
                  const freq = od.frequency || (order.orderType === "IV_Fluid" ? (od.rate || "") : "");
                  return (
                    <tr key={`${order._id}-${day.date.toISOString()}`}>
                      <td style={{ ...TD_STYLE, fontWeight: 700 }}>
                        {med}
                        {order.hamFlag && (
                          <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 3, background: "#fee2e2", color: "#b91c1c", fontSize: 9, fontWeight: 800 }}>
                            HAM
                          </span>
                        )}
                        {od.specialInstructions && (
                          <div style={{ fontSize: 10, color: "var(--pf-muted)", marginTop: 2, fontStyle: "italic" }}>
                            {od.specialInstructions}
                          </div>
                        )}
                      </td>
                      <td style={TD_STYLE}>
                        <div>{dose}</div>
                        {route && <div style={{ fontSize: 10, color: "var(--pf-muted)" }}>{route}</div>}
                      </td>
                      <td style={TD_STYLE}>{freq || "—"}</td>
                      <td style={TD_STYLE}>
                        {order.orderedBy || "—"}
                        <div style={{ fontSize: 10, color: "var(--pf-muted)" }}>
                          {order.orderedAt ? new Date(order.orderedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : ""}
                        </div>
                      </td>
                      <td style={TD_STYLE}>
                        {admins.length === 0 ? (
                          <span style={{ fontSize: 10.5, color: "var(--pf-muted)", fontStyle: "italic" }}>
                            (no doses recorded this day — order was {(() => {
                              const orderStart = new Date(order.orderedAt || order.createdAt || 0).getTime();
                              const dayStart = day.date.getTime();
                              return orderStart > dayStart + 86400000 - 1 ? "not yet placed" : "active but unadministered";
                            })()})
                          </span>
                        ) : (
                          admins
                            .slice()
                            .sort((a, b) => (a.scheduledTime || "").localeCompare(b.scheduledTime || ""))
                            .map((a, i) => <React.Fragment key={i}>{renderDoseChip(a)}</React.Fragment>)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* R7eg2 — ICU Bundles Compliance footer for THIS day. One row
                per applicable bundle, listing the shifts (M / E / N) that
                were finalized. A bullet "–" means no finalized sheet for
                that bundle today. Footer is hidden entirely when no
                bundles exist for any day (non-ICU patient). */}
            {Object.keys(bundlesByDate).length > 0 && (() => {
              const dayKey = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, "0")}-${String(day.date.getDate()).padStart(2, "0")}`;
              const today = bundlesByDate[dayKey] || {};
              const BUNDLE_LABELS = [
                ["vap",    "VAP"],
                ["cauti",  "CAUTI"],
                ["clabsi", "CLABSI"],
                ["dvt",    "DVT"],
                ["sepsis", "Sepsis"],
                ["sup",    "SUP"],
              ];
              const haveAny = BUNDLE_LABELS.some(([k]) => today[k]?.shifts?.length);
              if (!haveAny) return null;
              return (
                <div style={{
                  padding: "6px 12px",
                  background: "#f8fafc",
                  borderTop: "1px dashed #cbd5e1",
                  fontSize: 10.5, color: "#0f172a",
                  display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center",
                }}>
                  <span style={{ fontWeight: 800, color: "#3730a3", letterSpacing: 0.3, fontSize: 9.5, textTransform: "uppercase" }}>
                    ICU Bundles
                  </span>
                  {BUNDLE_LABELS.map(([k, label]) => {
                    const b = today[k];
                    const shifts = b?.shifts || [];
                    const ok = shifts.length > 0;
                    return (
                      <span key={k} style={{
                        padding: "1px 8px", borderRadius: 4,
                        background: ok ? "#dcfce7" : "#f1f5f9",
                        color: ok ? "#166534" : "#64748b",
                        border: `1px solid ${ok ? "#86efac" : "#cbd5e1"}`,
                        fontWeight: 700, fontSize: 10,
                      }}>
                        {label}: {ok ? `✓ ${shifts.join(",")}` : "–"}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   R7eg2 — ICU Care Bundles printable section.
   Renders one block per (date, shift) sheet. Inside each block,
   every APPLICABLE bundle (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP)
   shows its checklist items with ✓ / ✗ / N/A markers, the bundle
   compliance %, and the nurse who signed off. Sheets that are
   not yet finalized still render but are visually flagged "DRAFT".

   The sheets are pre-sorted (date asc, then shift M→E→N) by the
   backend's listByAdmission / patient-file aggregator, so we just
   iterate. We also insert a `pf-page-break` before each new day so
   long ICU stays paginate cleanly. NABH HIC.5 / COP.13 / IPSG.5.
─────────────────────────────────────────────────────────────── */
function ICUBundlesPrintSection({ bundles = [] }) {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    return <Empty icon="🛡️" msg="No ICU care bundles recorded" />;
  }

  const fmtTime = (when) => when
    ? new Date(when).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : "—";
  const fmtDate = (dStr) => {
    if (!dStr) return "—";
    try {
      const [y, m, d] = dStr.split("-").map((n) => parseInt(n, 10));
      const dt = new Date(y, (m || 1) - 1, d || 1);
      return dt.toLocaleDateString("en-IN", {
        weekday: "long", day: "2-digit", month: "long", year: "numeric",
      });
    } catch { return dStr; }
  };

  // Mark item with ✓ / ✗ / N/A. N/A only applies when the bundle itself
  // is flagged not-applicable — individual items don't carry a
  // tri-state, just checked/unchecked.
  const renderItemMark = (checked, applicable) => {
    if (!applicable) {
      return <span style={{ color: "#64748b", fontWeight: 800 }}>N/A</span>;
    }
    return checked
      ? <span style={{ color: "#16a34a", fontWeight: 900, fontSize: 13 }}>✓</span>
      : <span style={{ color: "#b91c1c", fontWeight: 900, fontSize: 13 }}>✗</span>;
  };

  // Group sheets by date so we can insert a date header + page-break per day.
  const byDate = useMemo(() => {
    const map = new Map();
    for (const s of bundles) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date).push(s);
    }
    // Already sorted by backend but enforce here for safety.
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [bundles]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11, color: "var(--pf-muted)", marginBottom: -6 }}>
        NABH HIC.5 (HAI prevention bundles) · COP.13 (ICU care standards) ·
        IPSG.5 (reduce HAI risk). Each shift sheet shows VAP / CAUTI / CLABSI /
        DVT / Sepsis / SUP with per-item compliance, signed by the bedside nurse.
      </div>

      {byDate.map(([dateStr, sheets], dayIdx) => (
        <div
          key={dateStr}
          style={{
            // First day breaks naturally; subsequent days insert a page
            // break before the date header so each ICU day starts on a
            // fresh page when printed.
            pageBreakBefore: dayIdx > 0 ? "always" : "auto",
            breakInside: "avoid-page",
          }}
        >
          <div style={{
            padding: "5px 12px",
            background: "linear-gradient(90deg, #ecfeff 0%, #fff 60%)",
            border: "1px solid #a5f3fc",
            borderLeft: "4px solid #0891b2",
            borderRadius: 6,
            marginBottom: 8,
            fontSize: 12.5, fontWeight: 800, color: "#0e7490",
          }}>
            📅 {fmtDate(dateStr)} — {sheets.length} shift sheet{sheets.length === 1 ? "" : "s"}
          </div>

          {sheets.map((sheet) => {
            return (
              <div
                key={sheet._id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  marginBottom: 10,
                  pageBreakInside: "avoid",
                  breakInside: "avoid",
                  overflow: "hidden",
                }}
              >
                <div style={{
                  padding: "5px 12px",
                  background: "#f8fafc",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                }}>
                  <span style={{ fontWeight: 800, color: "#0f172a", fontSize: 12 }}>
                    {sheet.shift} shift
                  </span>
                  <span style={{
                    padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 800,
                    background: sheet.status === "finalized" ? "#dcfce7" : "#fef3c7",
                    color: sheet.status === "finalized" ? "#166534" : "#92400e",
                    border: `1px solid ${sheet.status === "finalized" ? "#86efac" : "#fcd34d"}`,
                    textTransform: "uppercase",
                  }}>
                    {sheet.status}
                  </span>
                  <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 800, background: "#dbeafe", color: "#1e40af" }}>
                    Overall: {sheet.overallCompliancePct ?? 0}%
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--pf-muted)" }}>
                    {sheet.finalizedBy ? `Signed by ${sheet.finalizedBy} · ` : ""}
                    {fmtTime(sheet.finalizedAt)}
                  </span>
                </div>

                {(sheet.bundles || []).map((b) => (
                  <div
                    key={b.key}
                    style={{
                      padding: "6px 12px",
                      borderBottom: "1px dashed #e2e8f0",
                      breakInside: "avoid",
                    }}
                  >
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                      marginBottom: 4,
                    }}>
                      <span style={{ fontWeight: 800, fontSize: 11.5, color: "#0f172a" }}>
                        {b.title}
                      </span>
                      {!b.applicable && (
                        <span style={{ padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 800, background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }}>
                          NOT APPLICABLE
                        </span>
                      )}
                      {b.applicable && (
                        <span style={{
                          padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 800,
                          background: b.compliancePct === 100 ? "#dcfce7"
                                    : b.compliancePct >= 80 ? "#fef3c7"
                                    : "#fee2e2",
                          color:      b.compliancePct === 100 ? "#166534"
                                    : b.compliancePct >= 80 ? "#92400e"
                                    : "#b91c1c",
                        }}>
                          {b.compliancePct}%
                        </span>
                      )}
                      {b.nurseName && (
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--pf-muted)" }}>
                          {b.nurseName}{b.signedAt ? ` · ${fmtTime(b.signedAt)}` : ""}
                        </span>
                      )}
                    </div>

                    {(b.items || []).length > 0 && (
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 2 }}>
                        <tbody>
                          {b.items.map((it, i) => (
                            <tr key={i}>
                              <td style={{
                                width: 30, textAlign: "center", verticalAlign: "top",
                                padding: "2px 4px", fontSize: 11,
                              }}>
                                {renderItemMark(!!it.checked, b.applicable)}
                              </td>
                              <td style={{
                                padding: "2px 6px", fontSize: 10.5,
                                color: b.applicable ? "#0f172a" : "#94a3b8",
                              }}>
                                {it.label}
                                {it.notes && (
                                  <span style={{ display: "block", fontSize: 9.5, color: "var(--pf-muted)", fontStyle: "italic", marginTop: 1 }}>
                                    {it.notes}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}

                {sheet.notes && (
                  <div style={{
                    padding: "5px 12px", fontSize: 10.5, fontStyle: "italic",
                    background: "#fffbeb", color: "#78350f",
                  }}>
                    <b>Shift notes:</b> {sheet.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────── */
export default function CompletePatientFilePage() {
  const { uhid } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // R7cb-B: live hospital identity for the print letterhead + footer. Cached
  // after first call (see useHospitalSettings) so no extra API hit on reprint.
  const { settings: hospitalSettings } = useHospitalSettings();
  const role = (search.get("role") || "doctor").toLowerCase();
  // Real RBAC role from the authenticated user — used to gate role-specific
  // CTAs (e.g. Dietician's "Edit in console" button on the diet section).
  const viewerRole = user?.role || "";
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

  // Fire the browser print dialog once the data is rendered AND all images
  // (letterhead, signatures, logos) have decoded. R7g: previously this was a
  // blind 500ms setTimeout which often fired before signature <img> tags
  // finished loading, so the print preview had blank signature blocks.
  // afterprint closes the popup (no-op if it's the main tab).
  useEffect(() => {
    if (!autoprint || !data) return;
    let cancelled = false;
    const close = () => { try { window.close(); } catch {} };
    const imgs = Array.from(document.images);
    Promise.all(imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : (img.decode ? img.decode().catch(() => {}) : new Promise((r) => {
            img.addEventListener("load", r, { once: true });
            img.addEventListener("error", r, { once: true });
          }))
    )).then(() => {
      if (cancelled) return;
      setTimeout(() => {
        window.print();
        window.addEventListener("afterprint", close, { once: true });
      }, 200);
    });
    return () => { cancelled = true; };
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
    bedTransfers, shiftHandovers, dietPlans, timeline, completeness,
    // R7k: surface these in interactive view (previously fetched but never used)
    nursingCarePlans, nursingAssessments } = data;

  // Note types that have their OWN dedicated section now (Procedure Notes,
  // Intake/Output Sheet). Filter them out of the generic Doctor/Nurse
  // Notes feed so the same note doesn't appear twice in the file.
  // Plain consts (not useMemo) — these are cheap filters and putting
  // useMemo here after the early-return guards above would violate
  // React's Rules of Hooks.
  const RELOCATED_NURSE_TYPES = /^(intake|procedure|operative|preop|postop)$/i;
  const RELOCATED_DOC_TYPES   = /^(procedure|operative|preop|postop)$/i;

  const docInitialAll = doctorNotes.filter((n) =>  /initial/i.test(n.noteType || ""));
  const nurseInitial = nurseNotes.filter((n)  =>  /initial/i.test(n.noteType || ""));
  const docOther     = doctorNotes.filter((n) => !/initial/i.test(n.noteType || "") && !RELOCATED_DOC_TYPES.test(n.noteType || ""));
  const nurseOther   = nurseNotes.filter((n)  => !/initial/i.test(n.noteType || "") && !RELOCATED_NURSE_TYPES.test(n.noteType || ""));

  // R7g (Print bloat fix): collapse Initial-Assessment records to the latest
  // signed version per section (doctor / nursing). The patient may have 3
  // signed + 2 amended + 1 submitted IA rows — rendering all of them with
  // full NABH P0/P1/P2 trees produces 20-40 pages of duplicate output.
  // Activity Log still shows the full amendment history.
  const pickLatestIA = (arr, section) => arr
    .filter((n) => n.section === section || (!n.section && n.noteDetails?.[section]))
    .sort((a, b) => {
      const rank = (s) => s === "signed" ? 0 : s === "amended" ? 1 : 2;
      return rank(a.status) - rank(b.status)
        || new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    })[0];
  const latestDocIA   = pickLatestIA(docInitialAll, "doctor");
  const latestNurseIA = pickLatestIA(docInitialAll, "nursing");
  // If the per-section filter yields nothing (older rows without section
  // tags), fall back to the most-recent signed/amended/any IA so the
  // section never goes blank when records actually exist.
  const fallbackDocIA = !latestDocIA && docInitialAll.length
    ? [...docInitialAll].sort((a, b) => {
        const rank = (s) => s === "signed" ? 0 : s === "amended" ? 1 : 2;
        return rank(a.status) - rank(b.status)
          || new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      })[0]
    : null;
  const docInitial = [latestDocIA || fallbackDocIA, latestNurseIA].filter(Boolean);
  // Has any nurse-section IA been captured as a DoctorNote? If so the
  // admission-level nurseInitialAssessment fallback below is a duplicate
  // (7th dump) — skip it.
  const hasNurseSectionIA = Boolean(latestNurseIA)
    || nurseInitial.length > 0
    || docInitialAll.some((n) => n.section === "nursing" || n.noteDetails?.nursing);

  const navItems = [
    { id: "admission",     label: "Admission",          icon: "🛏", count: data.admissions?.length },
    { id: "initial",       label: "Initial Assessment", icon: "🩺", count: docInitial.length + nurseInitial.length },
    { id: "doctor-notes",  label: "Doctor Notes",       icon: "👨‍⚕️", count: docOther.length },
    { id: "nurse-notes",   label: "Nurse Notes",        icon: "👩‍⚕️", count: nurseOther.length },
    { id: "orders",        label: "Orders + MAR",       icon: "💊", count: doctorOrders.length },
    { id: "vitals",        label: "Vitals + I/O",       icon: "📈", count: vitals.length },
    { id: "io-sheet",      label: "Intake / Output Sheet", icon: "💧", count: null },
    { id: "procedures",    label: "Procedure Notes",    icon: "🩺", count: null },
    { id: "investigations",label: "Investigations",     icon: "🧪", count: investigations.length },
    { id: "consents",      label: "Consents",           icon: "📝", count: consents.length },
    { id: "diet",          label: "Diet Plans",         icon: "🥗", count: dietPlans?.length || 0 },
    // R7k: nav entries for the new (previously-hidden) nursing sections.
    { id: "care-plans",    label: "Care Plans",         icon: "📋", count: nursingCarePlans?.length || 0 },
    { id: "assessments",   label: "Nursing Assessments", icon: "📑", count: nursingAssessments?.length || 0 },
    { id: "blood",         label: "Blood Transfusion",  icon: "🩸", count: (nurseNotes || []).filter(n => matchBlood(n.noteData)).length },
    { id: "mlc",           label: "MLC",                icon: "⚖", count: mlc.length },
    { id: "handover",      label: "Handovers",          icon: "🔄", count: (bedTransfers?.length || 0) + (shiftHandovers?.length || 0) },
    { id: "discharge",     label: "Discharge",          icon: "🏥", count: dischargeSummary.length },
    { id: "billing",       label: "Billing",            icon: "💰", count: bills.length },
    { id: "activity",      label: "Activity Log",       icon: "🪵", count: activityLog.length },
    { id: "scoring",       label: "Scoring Trends",     icon: "📊", count: null },
    { id: "full-timeline", label: "Complete Timeline",  icon: "📜", count: null },
    { id: "timeline",      label: "UI Timeline",        icon: "📅", count: timeline.length },
  ];

  // ── Print-mode renders a clean linear A4 document with letterhead. No
  // sticky nav, no completeness strip, no scroll-spy. Everything visible
  // top-to-bottom so the browser print dialog gets the entire file in one
  // continuous stream.
  if (printMode) {
    // R7fq Track D — PrintShell (rendered inside PrintBody) now provides
    // the SGRH/Max-style triple-zone header, the patient-info strip and
    // the footer with digital-signature stamp + terms. PrintLetterhead
    // (R7eo) and PrintFooter (R7eo) are intentionally NOT invoked here
    // anymore so a single page doesn't double-stamp the header / repeat
    // the footer. Their function definitions remain in the file (still
    // referenced by no one) — left in place to keep the patch surgical
    // and to make a quick revert one-line if PrintShell turns out to
    // miss anything those custom blocks covered.
    return (
      <div className={`pf-page pf-print-mode pf-tint--${role === "nurse" ? "nurse" : "doctor"}`}>
        <PrintBody
          data={data}
          docInitial={docInitial}
          nurseInitial={nurseInitial}
          docOther={docOther}
          nurseOther={nurseOther}
          viewerRole={viewerRole}
          patient={patient}
          hospitalSettings={hospitalSettings}
          viewerName={user?.name || user?.fullName || ""}
          role={role}
          uhid={uhid}
        />
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
          {...(() => {
            // R7ft: route the print button through openPrint() →
            // /print/complete-ipd-file, which delegates to the admin-
            // picked theme (Narrative / Timeline / Executive / Audit /
            // Editorial) via CompleteIPDFile.jsx. The legacy
            // ?autoprint=1 same-page popup is preserved as the fallback
            // for two cases:
            //   1) `data` hasn't loaded yet (race on first click — the
            //      fetched payload is what we need to build the receipt)
            //   2) openPrint throws (sessionStorage full, popup
            //      blocker, browser quirk). We toast + fall through.
            //
            // R7fv — same receipt + same fallback for the Referral
            // Summary button. Only the slug differs: "referral-summary"
            // instead of "ipd-file". The theme component subsets the
            // receipt; the receipt itself is identical.
            const buildReceipt = () => {
              if (!data) throw new Error("Patient file not loaded yet");
              const adm = currentAdmission || data.currentAdmission || {};
              // R7ft-FIX1 — the real Initial Assessment blob lives in
              // doctorNotes[].noteDetails.doctor / .nursing (R7fa split).
              // currentAdmission.initialAssessment is only a thin marker.
              // Find the signed IA note and unpack noteDetails.doctor /
              // noteDetails.nursing — that's where hopi / chiefComplaints
              // / pmh / vitals / examination actually live.
              const allDoctorNotes  = Array.isArray(data.doctorNotes)  ? data.doctorNotes  : [];
              const allNursingNotes = Array.isArray(data.nursingNotes) ? data.nursingNotes : [];
              const iaDocNote   = allDoctorNotes.find(n => (n.noteType === "initial") && n.noteDetails?.doctor) ||
                                  allDoctorNotes.find(n => n.noteType === "initial");
              const iaNurseNote = allDoctorNotes.find(n => (n.noteType === "initial") && n.noteDetails?.nursing) ||
                                  allNursingNotes.find(n => n.noteType === "initial");
              const iaDoc   = iaDocNote?.noteDetails?.doctor
                              || adm.initialAssessment
                              || data.initialAssessment
                              || {};
              const iaNurse = iaNurseNote?.noteDetails?.nursing
                              || iaNurseNote?.noteData?.nursing
                              || adm.nurseInitialAssessment
                              || data.nurseInitialAssessment
                              || {};
              // Filter the loud "Doctor — initial" / "Nurse — initial"
              // entries out of the regular notes timeline — the IA is its
              // own dedicated print section, so leaving them in produces
              // the "Day 2: initial. initial. initial." garbage line the
              // user reported.
              const regularDoctorNotes  = allDoctorNotes.filter(n  => n.noteType !== "initial");
              const regularNursingNotes = allNursingNotes.filter(n => n.noteType !== "initial");
              // Normalize the IA vitals object. R7fc nurse IA stores vitals
              // as flat { bpSys, bpDia, pulse, temp, spo2, rr, weight,
              // height } — NOT a nested {bp:{systolic,diastolic}} object
              // like the original spec assumed. Handle BOTH shapes so the
              // adapter is forward-compatible.
              const rawVitals = iaNurse.vitals || iaDoc.vitals || {};
              const bpObj = rawVitals.bp;
              const bpFromObj  = bpObj && typeof bpObj === "object"
                                 ? `${bpObj.systolic ?? bpObj.sys ?? "?"}/${bpObj.diastolic ?? bpObj.dia ?? "?"}`
                                 : "";
              const bpFromStr  = typeof bpObj === "string" ? bpObj : "";
              const bpFromFlat = (rawVitals.bpSys || rawVitals.bpDia)
                                 ? `${rawVitals.bpSys ?? "?"}/${rawVitals.bpDia ?? "?"}`
                                 : "";
              const flatVitals = {
                bp:     bpFromStr || bpFromObj || bpFromFlat,
                pulse:  rawVitals.pulse,
                temp:   rawVitals.temp,
                spo2:   rawVitals.spo2,
                rr:     rawVitals.rr,
                weight: rawVitals.weight || iaNurse.anthropometry?.weightKg || iaDoc.anthropometry?.weightKg,
                height: rawVitals.height || iaNurse.anthropometry?.heightCm || iaDoc.anthropometry?.heightCm,
                bmi:    rawVitals.bmi    || iaNurse.anthropometry?.bmi      || iaDoc.anthropometry?.bmi,
              };
              const receipt = {
                /* identity */
                patientName: patient?.fullName || patient?.name || [patient?.firstName, patient?.lastName].filter(Boolean).join(" "),
                uhid:        patient?.UHID || patient?.uhid || uhid,
                ipdNo:       adm.admissionNumber || adm.ipdNo || "",
                age:         patient?.age,
                gender:      patient?.gender || patient?.sex,
                mobile:      patient?.mobile || patient?.contactNumber,
                bloodGroup:  patient?.bloodGroup,
                completeAddress: patient?.completeAddress || patient?.address,

                /* admission */
                admissionDate:   adm.admissionDate,
                admissionType:   adm.admissionType,
                modeOfArrival:   adm.modeOfArrival,
                referringDoctor: adm.referringDoctor,
                consultantName:  adm.attendingDoctor || adm.consultantName,
                department:      adm.department,
                bedNumber:       adm.bedNumber,
                wardName:        adm.wardName,
                reasonForAdmission:   adm.reasonForAdmission || adm.reasonForVisit,
                provisionalDiagnosis: adm.provisionalDiagnosis,
                workingDiagnosis:     adm.workingDiagnosis,
                finalDiagnosis:       adm.finalDiagnosis || data.dischargeSummary?.finalDiagnosis,
                icd10:           adm.icd10 || data.dischargeSummary?.icd10,
                icd10Desc:       adm.icd10Desc || data.dischargeSummary?.icd10Desc,
                dischargeDate:   adm.actualDischargeDate || adm.dischargeDate,
                totalDays:       adm.lengthOfStay || adm.totalDays,

                /* alerts */
                allergies:        data.allergies || iaDoc.allergies?.list || iaNurse.allergies?.list
                                  || patient?.allergyList || patient?.allergies || [],
                isolationFlags:   adm.isolationFlags || iaDoc.isolationFlags || [],
                crossCheckAlerts: iaNurse.crossCheckAlerts || iaDoc.crossCheckAlerts || [],

                /* vitals on admission — flattened above; bp is now a
                   "120/80" string, not a {systolic,diastolic} object. */
                vitalsOnAdmission: flatVitals,
                vitalsTrend:       data.vitalSheet || data.vitalsTrend || [],

                /* history & exam — every alias path the R7fa/R7fb/R7fc
                   IA forms can land in. The doctor IA's hopi field is
                   the primary HOPI bucket; nurse's chiefComplaint is a
                   common fallback when the doctor signed IA without
                   filling the field (real-world data gap). Real R7fc
                   field names: famHx, socHx, genExam (NOT
                   familyHistory / generalExamination). */
                chiefComplaints: iaDoc.chiefComplaints || iaDoc.cc || iaDoc.complaints
                                 || iaNurse.chiefComplaint || iaNurse.cc
                                 || adm.chiefComplaints || adm.reasonForAdmission || "",
                history:         iaDoc.hopi || iaDoc.historyOfPresentingIllness || iaDoc.history
                                 || iaDoc.presentingIllness
                                 || iaNurse.hopi || iaNurse.chiefComplaint || "",
                medicalHistory:  iaDoc.pmh || iaDoc.briefPmh || iaDoc.pastMedicalHistory
                                 || iaNurse.briefPmh || iaNurse.pmh || iaNurse.pastMedicalHistory || "",
                surgicalHistory: iaDoc.psh || iaDoc.surgicalHistory || iaDoc.pastSurgicalHistory || "",
                familyHistory:   iaDoc.famHx || iaDoc.familyHistory || "",
                socialHistory:   iaDoc.socHx || iaDoc.socialHistory || iaDoc.personalHistory || "",
                ia: { doctor: iaDoc, nursing: iaNurse },
                generalExamination:  iaDoc.genExam || iaDoc.examination || iaDoc.generalExamination || "",
                systemicExamination: [
                  iaDoc.cvs     ? `CVS: ${iaDoc.cvs}` : "",
                  iaDoc.rs      ? `RS: ${iaDoc.rs}`   : "",
                  iaDoc.abdomen ? `P/A: ${iaDoc.abdomen}` : "",
                  iaDoc.cns     ? `CNS: ${iaDoc.cns}` : "",
                  iaDoc.systemic || iaDoc.systemicExamination || "",
                ].filter(Boolean).join(" · "),

                /* clinical events — initial-assessment notes filtered
                   out so the Day-by-Day course doesn't spam "initial."
                   for each of them. The IA renders in its own section. */
                investigations:  data.investigations || [],
                doctorNotes:     regularDoctorNotes,
                nursingNotes:    regularNursingNotes,
                medications:     data.medications    || data.treatmentChart || [],
                // R7gb P0-9: backend never returns data.procedures;
                // synthesise from doctor + nurse notes whose noteType
                // matches the procedure regex used by
                // ProcedureNotesSection. Include actor/date/payload so
                // Narrative.procedures can render name + surgeon +
                // findings instead of "—".
                procedures: (() => {
                  const PROC_TYPES = /procedure|operative|preop|postop/i;
                  const fromDocs = allDoctorNotes
                    .filter(n => PROC_TYPES.test(n.noteType || ""))
                    .map(n => ({
                      name:        n.noteDetails?.procedureName || n.noteType,
                      date:        n.visitDate || n.createdAt,
                      surgeon:     n.doctorName || n.signedByName || "",
                      anaesthetist:n.noteDetails?.anaesthetist || n.noteDetails?.anesthetist || "",
                      findings:    n.noteDetails?.findings || n.noteDetails?.outcome || "",
                      notes:       n.noteDetails?.notes || n.remarks || n.note || "",
                      indication:  n.noteDetails?.indication || n.provisionalDiagnosis || "",
                      role:        "Doctor",
                      signedBy:    n.signedByName,
                      signedAt:    n.signedAt,
                    }));
                  const fromNurses = allNursingNotes
                    .filter(n => PROC_TYPES.test(n.noteType || ""))
                    .map(n => ({
                      name:        n.noteData?.procedureName || n.noteType,
                      date:        n.visitDate || n.noteDate || n.createdAt,
                      surgeon:     n.nurseName || n.signedByName || "",
                      anaesthetist:"",
                      findings:    n.noteData?.findings || n.noteData?.outcome || "",
                      notes:       n.noteData?.notes || n.remarks || "",
                      indication:  n.noteData?.indication || "",
                      role:        "Nurse",
                      signedBy:    n.signedByName,
                      signedAt:    n.submittedAt,
                    }));
                  return [...fromDocs, ...fromNurses].sort(
                    (a, b) => new Date(a.date || 0) - new Date(b.date || 0)
                  );
                })(),
                consents:        data.consents       || [],

                /* R7ft-FIX2 — comprehensive clinical record. Every
                   collection the backend returns is surfaced into the
                   receipt so the Narrative print is a true "complete
                   file", not a 1-page brief. dischargeSummary on the
                   API is often a 50-row array (find().limit(50)), so
                   we defensively pick the newest entry below. */
                doctorOrders:        Array.isArray(data.doctorOrders)        ? data.doctorOrders        : [],
                mar:                 Array.isArray(data.mar)                 ? data.mar                 : [],
                intakeOutput:        Array.isArray(data.intakeOutput)        ? data.intakeOutput        : [],
                labReports:          Array.isArray(data.labReports)          ? data.labReports          : [],
                labTrends:           Array.isArray(data.labTrends)           ? data.labTrends           : [],
                shiftHandovers:      Array.isArray(data.shiftHandovers)      ? data.shiftHandovers      : [],
                nursingAssessments:  Array.isArray(data.nursingAssessments)  ? data.nursingAssessments  : [],
                nursingCarePlans:    Array.isArray(data.nursingCarePlans)    ? data.nursingCarePlans    : [],
                bedTransfers:        Array.isArray(data.bedTransfers)        ? data.bedTransfers        : [],
                // R7gb P0-10: on-page Blood Transfusion section also
                // scans nurse notes via matchBlood(noteData) — many
                // transfusion events are saved as nurse-note payloads,
                // not in the dedicated bloodTransfusion collection.
                // Mirror that scan into the receipt.
                bloodTransfusion: (() => {
                  const dedicated = Array.isArray(data.bloodTransfusion) ? data.bloodTransfusion : [];
                  const fromNurseNotes = allNursingNotes
                    .filter(n => matchBlood(n.noteData))
                    .map(n => ({
                      ...n.noteData,
                      startedAt:        n.visitDate || n.noteDate || n.createdAt,
                      createdAt:        n.createdAt,
                      transfusedByName: n.nurseName || n.signedByName || "",
                      _source:          "nurseNote",
                    }));
                  return [...dedicated, ...fromNurseNotes].sort(
                    (a, b) => new Date(a.startedAt || a.createdAt || 0) - new Date(b.startedAt || b.createdAt || 0)
                  );
                })(),
                dietPlans:           Array.isArray(data.dietPlans)           ? data.dietPlans           : [],
                icuBundles:          Array.isArray(data.icuBundles)          ? data.icuBundles          : [],
                mlc:                 Array.isArray(data.mlc)                 ? data.mlc                 : [],
                // R7gb P0-11: surface backend bills so the Narrative
                // bills section is wired.
                bills:               Array.isArray(data.bills)               ? data.bills               : [],
                // R7gb P0-12: activity log is operational/PHI-adjacent
                // — gate to the same roles permitted on-page (line
                // 2586). Other viewers get an empty array so the
                // section auto-elides.
                activityLog:         ["Admin", "Doctor", "MRD", "Accountant"].includes(viewerRole)
                                       ? (Array.isArray(data.activityLog) ? data.activityLog : [])
                                       : [],

                /* discharge — defensive resolve: the API may return
                   dischargeSummary as either an object (singleton) or
                   an array (find().limit(50)). Pick the newest. */
                ...((ds) => {
                  const head = Array.isArray(ds) ? ds[0] : ds;
                  return {
                    dischargeSummary:     head?.summary || head?.courseOfStay || "",
                    dischargeAdvice:      head?.advice || head?.finalAdvice || "",
                    dischargeMedications: head?.dischargeMeds || head?.medsOnDischarge || head?.dischargeMedications || [],
                    followUpDate:         head?.followUpDate,
                    dischargeCondition:   head?.conditionOnDischarge,
                  };
                })(data.dischargeSummary),

                printCount: 1,
                printedAt:  new Date().toISOString(),

                /* R7gb-P0-12 — viewer role propagation. CompleteIPDFile.jsx
                   reads receipt.viewerRole and passes it to the theme as a
                   first-class prop so PHI-heavy sections (Activity Log,
                   MLC) can gate by role. Lowercase canonical form. */
                viewerRole: String(viewerRole || "").toLowerCase(),
              };
              return receipt;
            };
            const fireFallback = () => {
              const url = `/patient-file/${uhid}?role=${role}&autoprint=1`;
              const w = window.open(url, "_blank", "noopener,width=1100,height=900");
              if (!w || w.closed || typeof w.closed === "undefined") {
                try { toast.warn("Pop-up blocked — opening in same tab. Use Ctrl+P to print."); } catch {}
                setTimeout(() => { window.location.href = url; }, 500);
              }
            };
            return {
              // R7ga — REVERTED R7fz. R7fz routed Print through the
              // page's own ?autoprint=1 path, which printed a literal
              // mirror of the on-page UI — 36 pages of UI elements,
              // role tints, sidebars and chip soup. User feedback:
              // "this not as structered patient file" — they wanted
              // the Narrative theme's compact structured output.
              // Back to openPrint("ipd-file", ...) which dispatches
              // to CompleteIPDFile.jsx → admin-picked theme. R7fy's
              // day-wise restructure of Narrative.jsx + R7fx-A's
              // shared improvements remain active because they were
              // applied INSIDE the theme. fireFallback() stays as
              // safety net for openPrint throws (pop-up blocker,
              // sessionStorage full).
              onPrint: () => {
                try { openPrint("ipd-file", buildReceipt()); }
                catch (e) { fireFallback(); }
              },
              onPrintReferral: () => {
                try { openPrint("referral-summary", buildReceipt()); }
                catch (e) { fireFallback(); }
              },
            };
          })()}
        />
        {/* R7i: Same-day discharge undo (Admin only). Component
            short-circuits when conditions aren't met. */}
        <ReactivateBanner
          admission={currentAdmission}
          viewerRole={viewerRole}
          onReactivated={() => {
            // Force a fresh fetch so the page reflects status=Active.
            setData(null);
            axios.get(`${BASE}/patient-file/${uhid}/complete`)
              .then((res) => setData(res.data?.data || null))
              .catch((e) => setErr(e.response?.data?.message || e.message));
          }}
        />
        <Completeness completeness={completeness} />
        <PendingActions data={data} />

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
              <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, fontSize: 12, color: "#78350f" }}>
                Showing latest signed version. Full amendment history visible in Activity Log.
              </div>
              <h4 style={{ margin: "0 0 8px", color: "var(--pf-accent-d)" }}>Doctor — Initial Assessment</h4>
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Doctor"]} href="/ipd-assessment/{UHID}"
                color="#7c3aed" label="Add Doctor IA in console" icon="✏" />
              <NoteList notes={latestDocIA || fallbackDocIA ? [latestDocIA || fallbackDocIA] : []} kind="doctor" emptyMsg="Doctor initial assessment not recorded" />
              <h4 style={{ margin: "16px 0 8px", color: "var(--pf-accent-d)" }}>Nursing — Initial Assessment</h4>
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Nurse"]} href="/nurse-initial-assessment?uhid={UHID}"
                color="#db2777" label="Add Nursing IA in console" icon="✏" />
              <NoteList notes={latestNurseIA ? [latestNurseIA] : nurseInitial} kind="nurse" emptyMsg="Nursing initial assessment not recorded" />
              {/* The dedicated /nurse-initial-assessment page stores its full
                  NABH-required payload directly on the admission document
                  (admission.nurseInitialAssessment, type: Mixed). It's
                  separate from NurseNote.noteData and was never being
                  surfaced here. Render every populated field.
                  R7g: skip when a nurse-section DoctorNote already covers it
                  (else this becomes a 7th duplicate dump). */}
              {!hasNurseSectionIA && isMeaningful(currentAdmission?.nurseInitialAssessment) && (
                <div className="pf-record pf-record--nurse" style={{ marginTop: 12 }}>
                  <div className="pf-record__head">
                    <span className="pf-record__title">Nurse IA — full assessment payload</span>
                    <span className="pf-record__time">stored on admission</span>
                  </div>
                  <div className="pf-record__body">
                    <MixedFields data={currentAdmission.nurseInitialAssessment} />
                  </div>
                </div>
              )}
              {/* Same idea for the admission-level doctor IA payload, if any.
                  R7g: only render when no doctor-section IA already covers it. */}
              {!(latestDocIA || fallbackDocIA) && isMeaningful(currentAdmission?.initialAssessment) && (
                <div className="pf-record pf-record--doctor" style={{ marginTop: 12 }}>
                  <div className="pf-record__head">
                    <span className="pf-record__title">Doctor IA gate</span>
                    <span className="pf-record__time">recorded on admission</span>
                  </div>
                  <div className="pf-record__body">
                    <MixedFields data={currentAdmission.initialAssessment} />
                  </div>
                </div>
              )}
            </Section>

            <Section id="doctor-notes" icon="👨‍⚕️" title="Doctor Notes" sub="Progress, ICU, procedure, consultation" count={docOther.length}>
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Doctor"]} href="/doctor-notes?uhid={UHID}"
                color="#7c3aed" label="New doctor note" />
              <NoteList notes={docOther} kind="doctor" emptyMsg="No doctor notes" />
            </Section>

            <Section id="nurse-notes" icon="👩‍⚕️" title="Nursing Notes" sub="Categorised — every shift entry" count={nurseOther.length}>
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Nurse"]} href="/nursing-notes?uhid={UHID}"
                color="#db2777" label="New nursing note" />
              <NoteList notes={nurseOther} kind="nurse" emptyMsg="No nursing notes" />
            </Section>

            <Section id="orders" icon="💊" title="Orders + MAR" sub="Medications, IV, procedures — with admin trail" count={doctorOrders.length}>
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Doctor"]} href="/doctor-notes?uhid={UHID}&tab=orders"
                color="#7c3aed" label="New order" />
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Nurse"]} href="/mar?uhid={UHID}"
                color="#db2777" label="Open MAR" icon="💊" />
              <OrdersSection orders={doctorOrders} />
            </Section>

            <Section id="io-sheet" icon="💧" title="Intake / Output Sheet" sub="All I/O entries across nursing notes — grouped date → shift, with daily totals and net balance. Print-ready.">
              <IOSheetSection nurseNotes={nurseNotes} currentAdmission={currentAdmission} />
            </Section>

            <Section id="procedures" icon="🩺" title="Procedure Notes" sub="Every procedure performed by Doctor or Nurse — date → shift, with role badges and full payload.">
              <ProcedureNotesSection doctorNotes={doctorNotes} nurseNotes={nurseNotes} />
            </Section>

            <Section id="vitals" icon="📈" title="Vital Trends" sub="Every vital recorded — both dedicated sheet + embedded in nursing notes">
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Nurse", "Doctor"]}
                href={`/updateVitalSheet/{UHID}/${new Date().toISOString().slice(0,10)}`}
                color="#0d9488" label="Record vitals (today)" icon="📈" />
              <VitalsSection vitals={vitals} nurseNotes={nurseNotes} doctorNotes={doctorNotes} currentAdmission={currentAdmission} />
            </Section>

            <Section id="investigations" icon="🧪" title="Investigations" sub="Lab + imaging orders with results" count={investigations.length}>
              <InvestigationSection investigations={investigations} />
            </Section>

            <Section id="consents" icon="📝" title="Consent Forms" sub="NABH PRE.3 / PRE.4 — every consent with full audit trail" count={consents.length}>
              <ConsentSection consents={consents} />
            </Section>

            <Section id="diet" icon="🥗" title="Dietician — Diet Plans" sub="Nutritional assessment + assigned diet plan with meal snapshot" count={dietPlans?.length || 0}>
              <DietPlansSection dietPlans={dietPlans} uhid={uhid} viewerRole={viewerRole} />
            </Section>

            {/* R7k: Nursing Care Plans (NABH COP.3) — previously fetched
                from /api/nursing-care-plans but never rendered, so a
                nurse's saved Care Plan was invisible in the file. */}
            <Section id="care-plans" icon="📋" title="Nursing Care Plans" sub="NABH COP.3 — problems, goals, interventions, outcomes" count={nursingCarePlans?.length || 0}>
              <CarePlansSection carePlans={nursingCarePlans || []} />
            </Section>

            {/* R7k: Nursing Assessments (Daily / Nutrition / Patient Ed) —
                live on the NursingAssessment model and were never surfaced
                in the file UI. Grouped by type for easy scanning. */}
            <Section id="assessments" icon="📑" title="Nursing Assessments" sub="Daily · Nutritional · Patient education — every saved record" count={nursingAssessments?.length || 0}>
              <NursingAssessmentsSection assessments={nursingAssessments || []} />
            </Section>

            {/* R7k: Dedicated Blood Transfusion Records (NABH MOM.7) —
                pulls every nurse note whose payload matches the blood-
                transfusion shape (bag #, cross-match, pre/post vitals,
                reaction status). Previously these were buried inline
                in the generic Nurse Notes feed. */}
            {(() => {
              const bloodEvents = (nurseNotes || [])
                .filter((n) => matchBlood(n.noteData))
                .sort((a, b) => new Date(b.visitDate || b.createdAt) - new Date(a.visitDate || a.createdAt));
              return (
                <Section id="blood" icon="🩸" title="Blood Transfusion Records" sub="NABH MOM.7 — every bag with pre/post vitals + reaction status" count={bloodEvents.length}>
                  {bloodEvents.length === 0
                    ? <Empty icon="🩸" msg="No blood transfusions recorded" />
                    : bloodEvents.map((n) => (
                        <div key={n._id} className="pf-record pf-record--nurse" style={{ marginBottom: 10 }}>
                          <div className="pf-record__head">
                            <span className="pf-record__title">Transfusion event</span>
                            <span className="pf-record__time">{fmtDT(n.visitDate || n.createdAt)}</span>
                            <span className="pf-record__by">by {n.nurseName || "Nurse"}</span>
                          </div>
                          <BloodTransfusionPanel data={n.noteData} />
                        </div>
                      ))
                  }
                </Section>
              );
            })()}

            <Section id="mlc" icon="⚖" title="Medico-Legal Cases" sub="MLC reports with FIR linkage" count={mlc.length}>
              <MLCSection mlc={mlc} />
            </Section>

            {/* R7k: Bed Transfers stay in the permanent record (NABH AAC.3).
                Same-day SBAR handovers are operational ephemera — separated
                so the permanent file stays clean. */}
            <Section id="handover" icon="🔄" title="Bed Transfers + Shift Handovers" sub="Bed transfers permanent · SBAR handovers same-day only">
              {(bedTransfers?.length || 0) === 0 && (shiftHandovers?.length || 0) === 0
                ? <Empty icon="🔄" msg="No transfers or handovers recorded" />
                : (
                  <>
                    {(bedTransfers?.length || 0) > 0 && (
                      <>
                        <h4 style={{ margin: "0 0 8px", color: "var(--pf-accent-d)" }}>🛏 Bed transfers</h4>
                        {bedTransfers.map((t) => (
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
                      </>
                    )}
                    {(() => {
                      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
                      const today = (shiftHandovers || []).filter((h) =>
                        h.createdAt && new Date(h.createdAt) >= startOfToday);
                      const older = (shiftHandovers || []).filter((h) =>
                        h.createdAt && new Date(h.createdAt) < startOfToday);
                      return (
                        <>
                          {today.length > 0 && (
                            <>
                              <h4 style={{ margin: "12px 0 8px", color: "var(--pf-accent-d)" }}>
                                🔄 Today's SBAR shift handovers <span style={{ fontWeight: 500, color: "var(--pf-muted)", fontSize: 12 }}>({today.length})</span>
                              </h4>
                              {today.map((h) => (
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
                          )}
                          {older.length > 0 && (
                            <details style={{ marginTop: 10, padding: 10, background: "#f8fafc", borderRadius: 6, fontSize: 12 }}>
                              <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--pf-muted)" }}>
                                Older handovers ({older.length}) — operational history, not part of permanent record
                              </summary>
                              <div style={{ marginTop: 8 }}>
                                {older.map((h) => (
                                  <div key={h._id} className="pf-record pf-record--nurse" style={{ opacity: .85 }}>
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
                              </div>
                            </details>
                          )}
                        </>
                      );
                    })()}
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

            {/* R7r: Activity Log restricted to audit-eligible roles
                (NABH AAC.7). The full UI audit feed identifies which staff
                accessed which patient at which time — sensitive metadata
                that NABH treats as access-controlled. Clinicians acting
                on the patient (Nurse, Pharmacist, etc.) don't need this;
                only Admin / Doctor (treating) / MRD (records) /
                Accountant (audit) need visibility. Wrong-role users see
                a stub instead of the data. */}
            {["Admin", "Doctor", "MRD", "Accountant"].includes(viewerRole) ? (
              <Section id="activity" icon="🪵" title="Activity Log" sub="Every click, edit, dropdown selection — full UI audit feed (NABH AAC.7)" count={activityLog.length}>
                <ActivityFeed activityLog={activityLog} />
              </Section>
            ) : (
              <Section id="activity" icon="🪵" title="Activity Log" sub="Restricted to Admin / Doctor / MRD / Accountant (NABH AAC.7)">
                <div style={{ padding: 28, textAlign: "center", color: "var(--pf-muted)", fontSize: 13 }}>
                  🔒 Audit feed access is limited to authorized roles per NABH AAC.7.
                </div>
              </Section>
            )}

            <Section id="scoring" icon="📊" title="Scoring Trends" sub="Braden / Morse / MEWS / GCS — every entry, by date and shift, with total & risk band">
              <ScoringTrendsSection nurseNotes={nurseNotes} doctorNotes={doctorNotes} currentAdmission={currentAdmission} />
            </Section>

            <Section id="full-timeline" icon="📜" title="Complete Timeline" sub="Every clinical event — date → shift → time. Print-ready chronological view.">
              <TimelineSection data={data} />
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
