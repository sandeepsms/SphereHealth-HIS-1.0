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
import { useAuth } from "../../context/AuthContext";
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

      {(preVitals || postVitals) && (
        <div style={{
          display: "grid", gridTemplateColumns: "60px 1fr", gap: "2px 8px",
          fontSize: 11, padding: "6px 8px", background: "#fff",
          borderRadius: 4, border: "1px dashed #fecaca",
        }}>
          {preVitals && (<>
            <span style={{ fontWeight: 800, color: "#b91c1c" }}>PRE</span>
            <span style={{ fontFamily: "monospace" }}>{preVitals}</span>
          </>)}
          {postVitals && (<>
            <span style={{ fontWeight: 800, color: "#b91c1c" }}>POST</span>
            <span style={{ fontFamily: "monospace" }}>{postVitals}</span>
          </>)}
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

  // Blood-transfusion record gets a dedicated safety-critical panel.
  if (matchBlood(data)) return <BloodTransfusionPanel data={data} />;

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
          {(n.isCritical || n.isCriticalEvent) && <span className="pf-badge pf-badge--err">CRITICAL</span>}
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
  const { user } = useAuth();
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
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Doctor"]} href="/ipd-assessment/{UHID}"
                color="#7c3aed" label="Add Doctor IA in console" icon="✏" />
              <NoteList notes={docInitial} kind="doctor" emptyMsg="Doctor initial assessment not recorded" />
              <h4 style={{ margin: "16px 0 8px", color: "var(--pf-accent-d)" }}>Nursing — Initial Assessment</h4>
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Nurse"]} href="/nurse-initial-assessment?uhid={UHID}"
                color="#db2777" label="Add Nursing IA in console" icon="✏" />
              <NoteList notes={nurseInitial} kind="nurse" emptyMsg="Nursing initial assessment not recorded" />
              {/* The dedicated /nurse-initial-assessment page stores its full
                  NABH-required payload directly on the admission document
                  (admission.nurseInitialAssessment, type: Mixed). It's
                  separate from NurseNote.noteData and was never being
                  surfaced here. Render every populated field. */}
              {isMeaningful(currentAdmission?.nurseInitialAssessment) && (
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
              {/* Same idea for the admission-level doctor IA payload, if any */}
              {isMeaningful(currentAdmission?.initialAssessment) && (
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

            <Section id="vitals" icon="📈" title="Vital Trends" sub="Every vital recorded — both dedicated sheet + embedded in nursing notes">
              <RoleAddCTA viewerRole={viewerRole} uhid={uhid}
                allow={["Nurse", "Doctor"]}
                href={`/updateVitalSheet/{UHID}/${new Date().toISOString().slice(0,10)}`}
                color="#0d9488" label="Record vitals (today)" icon="📈" />
              <VitalsSection vitals={vitals} nurseNotes={nurseNotes} />
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
