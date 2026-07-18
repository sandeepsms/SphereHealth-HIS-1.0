/**
 * TimelineNoteCard.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Unified rich card renderer for every doctor / nursing note in the
 * Notes Timeline. Outer shell (left rail + time bubble, header row,
 * right action stack) is identical for every type; only the BODY
 * differs. A per-type body renderer is selected by `note.noteType`.
 *
 * Visual reference: matches the DAILY PROGRESS SOAP card (2×2 sub-cards
 * with coloured left rules + vitals strip). The same visual quality is
 * applied to Initial Assessment, Procedure, Pre-Op, Post-Op, Discharge,
 * Consult Reply, Emergency Triage, Death Summary, Referral, Add Note.
 *
 * Props
 *   note          — the note object from the API
 *   currentUserId — for edit/sign gating (optional)
 *   onEdit        — (note)=>void          (Edit button — draft + own author only)
 *   onSign        — (note)=>void          (Sign button — draft only)
 *   onPrint       — (note)=>void          (Print button)
 *   defaultOpen   — boolean (default true) — card body starts expanded
 * ───────────────────────────────────────────────────────────────────────── */

import React, { useState } from "react";
// R7gv — Same per-type card HTML the printed Complete File renders.
// TimelineNoteCard keeps its own outer shell + action toolbar but the
// body now mirrors the print exactly, including the SIGNED footer with
// Emp ID + digital signature image (R7go / R7gu).
import { buildDoctorNoteCardHtml } from "../../pages/doctor/buildDoctorNoteCardHtml";
import { buildNurseNoteCardHtml }  from "../../pages/nursing/printNurseNote";
import { useInlinedUploadsHtml }   from "../../utils/secureUploads";

/* ── Note-type accent colour palette ────────────────────────────────── */
const ACCENT = {
  daily:        { color: "#4f46e5", tint: "#e0e7ff", soft: "#eef2ff", label: "DAILY PROGRESS",      icon: "pi-file-edit" },
  progress:     { color: "#4f46e5", tint: "#e0e7ff", soft: "#eef2ff", label: "DAILY PROGRESS",      icon: "pi-file-edit" },
  initial:      { color: "#7c3aed", tint: "#ede9fe", soft: "#f5f3ff", label: "INITIAL ASSESSMENT",  icon: "pi-clipboard" },
  assessment:   { color: "#7c3aed", tint: "#ede9fe", soft: "#f5f3ff", label: "INITIAL ASSESSMENT",  icon: "pi-clipboard" },
  procedure:    { color: "#0891b2", tint: "#cffafe", soft: "#ecfeff", label: "PROCEDURE NOTE",      icon: "pi-cog" },
  operative:    { color: "#0891b2", tint: "#cffafe", soft: "#ecfeff", label: "OPERATIVE NOTE",      icon: "pi-cog" },
  preop:        { color: "#475569", tint: "#e2e8f0", soft: "#f1f5f9", label: "PRE-OP NOTE",         icon: "pi-clock" },
  postop:       { color: "#059669", tint: "#d1fae5", soft: "#ecfdf5", label: "POST-OP NOTE",        icon: "pi-check-circle" },
  general:      { color: "#64748b", tint: "#e2e8f0", soft: "#f1f5f9", label: "NOTE",                icon: "pi-file" },
  emergency:    { color: "#dc2626", tint: "#fee2e2", soft: "#fef2f2", label: "EMERGENCY TRIAGE",    icon: "pi-bolt" },
  discharge:    { color: "#10b981", tint: "#d1fae5", soft: "#ecfdf5", label: "DISCHARGE NOTE",      icon: "pi-sign-out" },
  consultation: { color: "#4f46e5", tint: "#e0e7ff", soft: "#eef2ff", label: "CONSULT REPLY",       icon: "pi-users" },
  referral:     { color: "#0284c7", tint: "#e0f2fe", soft: "#f0f9ff", label: "REFERRAL",            icon: "pi-share-alt" },
  death:        { color: "#0f172a", tint: "#cbd5e1", soft: "#f1f5f9", label: "DEATH SUMMARY",       icon: "pi-exclamation-triangle" },
  icu:          { color: "#dc2626", tint: "#fee2e2", soft: "#fef2f2", label: "ICU NOTE",            icon: "pi-heart" },
  amendment:    { color: "#d97706", tint: "#fde68a", soft: "#fffbeb", label: "AMENDMENT",           icon: "pi-pencil" },
  admission:    { color: "#7c3aed", tint: "#ede9fe", soft: "#f5f3ff", label: "ADMISSION NOTE",      icon: "pi-id-card" },
  "nursing-note":{ color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "NURSING NOTE",       icon: "pi-heart-fill" },
  "shift-note": { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "SHIFT NOTE",          icon: "pi-clock" },
  // Nursing module noteType values (NurseNotes model) — all route to teal nursing accent
  vitals:            { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "VITALS",                icon: "pi-heart-fill" },
  neuroAssessment:   { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "NEURO ASSESSMENT",      icon: "pi-heart-fill" },
  bloodTransfusion:  { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "BLOOD TRANSFUSION",     icon: "pi-heart-fill" },
  ivInfusion:        { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "IV INFUSION",           icon: "pi-heart-fill" },
  intakeOutput:      { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "INTAKE / OUTPUT",       icon: "pi-heart-fill" },
  painAssessment:    { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "PAIN ASSESSMENT",       icon: "pi-heart-fill" },
  woundCare:         { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "WOUND CARE",            icon: "pi-heart-fill" },
  skinAssessment:    { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "SKIN ASSESSMENT",       icon: "pi-heart-fill" },
  fallRisk:          { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "FALL RISK",             icon: "pi-heart-fill" },
  mewsScore:         { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "MEWS SCORE",            icon: "pi-heart-fill" },
  dailyAssessment:   { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "DAILY ASSESSMENT",      icon: "pi-heart-fill" },
  initialAssessment: { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "INITIAL ASSESSMENT",    icon: "pi-heart-fill" },
  carePlan:          { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "CARE PLAN",             icon: "pi-heart-fill" },
  nutritionalAssessment: { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "NUTRITIONAL ASSESSMENT", icon: "pi-heart-fill" },
  patientEducation:  { color: "#0d9488", tint: "#ccfbf1", soft: "#f0fdfa", label: "PATIENT EDUCATION",     icon: "pi-heart-fill" },
};
const NURSING_TYPES = new Set([
  "nursing-note", "shift-note", "vitals", "neuroAssessment", "bloodTransfusion",
  "ivInfusion", "intakeOutput", "painAssessment", "woundCare", "skinAssessment",
  "fallRisk", "mewsScore", "dailyAssessment", "initialAssessment", "carePlan",
  "nutritionalAssessment", "patientEducation",
]);
const accentOf = t => ACCENT[t] || ACCENT.general;

/* ── SubCard colour map (left-rule + tint + label colour) ─────────── */
const SUB_COLOR = {
  blue:    { rule: "#4f46e5", bg: "#eef2ff", label: "#4338ca" },
  green:   { rule: "#16a34a", bg: "#f0fdf4", label: "#15803d" },
  amber:   { rule: "#d97706", bg: "#fffbeb", label: "#92400e" },
  teal:    { rule: "#0d9488", bg: "#f0fdfa", label: "#0f766e" },
  violet:  { rule: "#7c3aed", bg: "#f5f3ff", label: "#6d28d9" },
  slate:   { rule: "#475569", bg: "#f1f5f9", label: "#334155" },
  crimson: { rule: "#dc2626", bg: "#fef2f2", label: "#991b1b" },
  indigo:  { rule: "#4f46e5", bg: "#eef2ff", label: "#3730a3" },
  emerald: { rule: "#10b981", bg: "#ecfdf5", label: "#047857" },
  sky:     { rule: "#0284c7", bg: "#f0f9ff", label: "#0369a1" },
  rose:    { rule: "#e11d48", bg: "#fff1f2", label: "#9f1239" },
};

/* ════════════════════════════════════════════════════════════════════
   Reusable primitives — exported as named exports
   ════════════════════════════════════════════════════════════════════ */

export function SubCard({ color = "slate", label, children, dense = false }) {
  const c = SUB_COLOR[color] || SUB_COLOR.slate;
  return (
    <div style={{
      background: c.bg,
      borderLeft: `3px solid ${c.rule}`,
      borderRadius: 6,
      padding: dense ? "6px 10px" : "8px 12px",
      breakInside: "avoid",
    }}>
      {label && (
        <div style={{
          fontSize: 9,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: ".6px",
          color: c.label,
          marginBottom: 4,
        }}>{label}</div>
      )}
      <div style={{ fontSize: 11.5, color: "#0f172a", lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {children}
      </div>
    </div>
  );
}

export function VitalsStrip({ vitals }) {
  if (!vitals || typeof vitals !== "object") return null;
  const v = vitals;
  const bpStr = v.bp ? `${v.bp.systolic ?? "—"}/${v.bp.diastolic ?? "—"}` : (v.bp_sys || v.bp_dia ? `${v.bp_sys || "—"}/${v.bp_dia || "—"}` : null);
  const items = [
    { l: "BP",    v: bpStr },
    { l: "Pulse", v: v.pulse ? `${v.pulse}/min` : null },
    { l: "Temp",  v: v.temp ? `${v.temp}°F` : null },
    { l: "SpO₂",  v: v.spo2 ? `${v.spo2}%` : null },
    { l: "RR",    v: v.rr ? `${v.rr}/min` : null },
    { l: "RBS",   v: v.bsl || v.rbs ? `${v.bsl || v.rbs}mg/dL` : null },
    { l: "GCS",   v: v.gcs ? String(v.gcs) : null },
    { l: "Urine", v: v.urine ? `${v.urine}mL` : null },
  ].filter(f => f.v);
  if (!items.length) return null;
  return (
    <div className="dnp-vitals-strip">
      <span className="dnp-vitals-strip__heading">Vitals</span>
      {items.map(f => (
        <div key={f.l} className="dnp-vitals-strip__item">
          <span className="dnp-vitals-strip__k">{f.l}</span>
          <span className="dnp-vitals-strip__v">{f.v}</span>
        </div>
      ))}
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    draft:    { bg: "#fef3c7", color: "#92400e", border: "#fbbf24", text: "DRAFT" },
    signed:   { bg: "#dcfce7", color: "#166534", border: "#86efac", text: "✓ SIGNED" },
    amended:  { bg: "#e0e7ff", color: "#4338ca", border: "#93c5fd", text: "AMENDED" },
    revoked:  { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", text: "REVOKED" },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 9.5,
      fontWeight: 800,
      letterSpacing: ".5px",
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>{s.text}</span>
  );
}

// R7hr(NOTE-WRAP, owner 2026-07-12) — "halka wrapper": the type pill is now a
// neutral grey chip with NO icon and NO per-type colour. The type NAME stays
// (scannability), the colour chrome goes; Signed/Draft badge + the date/time
// rail are the only status colour left on the list wrapper.
export function TypePill({ type, label }) {
  const a = accentOf(type);
  return (
    <span style={{
      padding: "3px 10px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: ".5px",
      background: "#f1f5f9",
      color: "#475569",
      border: "1px solid #e2e8f0",
      display: "inline-flex",
      alignItems: "center",
    }}>
      {label || a.label}
    </span>
  );
}

export function DoctorMeta({ name, reg }) {
  if (!name && !reg) return null;
  return (
    <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>
      {name && <span>{name}</span>}
      {name && reg && <span style={{ margin: "0 6px", color: "#cbd5e1" }}>·</span>}
      {reg && <span style={{ color: "#64748b" }}>Reg {reg}</span>}
    </span>
  );
}

export function ChipRow({ chips = [] }) {
  if (!chips.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {chips.map((c, i) => {
        const col = SUB_COLOR[c.tone] || SUB_COLOR.slate;
        return (
          <span key={i} style={{
            padding: "2px 9px",
            borderRadius: 11,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".4px",
            background: col.bg,
            color: col.label,
            border: `1px solid ${col.rule}55`,
          }}>{c.label}</span>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   R7gw — Legacy Body* React renderers + inline helpers (nonEmpty, txt,
   pick, Grid, Kv, AllergyCallout) were removed here. BodyFor() below
   dispatches to buildDoctorNoteCardHtml / buildNurseNoteCardHtml since
   R7gv; the prior 14 per-type renderers (BodyDailyProgress, BodyInitial-
   Assessment, BodyProcedure, BodyPreop, BodyPostop, BodyConsult,
   BodyEmergency, BodyDischarge, BodyReferral, BodyDeath, BodyICU,
   BodyAmendment, BodyNursing, BodyFreeNote) were unreachable dead code.
   ════════════════════════════════════════════════════════════════════ */

/* Body renderer dispatcher ------------------------------------------- */
function BodyFor({ note }) {
  // R7gv — Single source of truth for the body artwork: the same per-type
  // card builder Complete File / patient panel pills use. Renders the
  // structured card (Vitals/SOAP/Diagnosis/Med Rec/etc.) + the SIGNED
  // footer carrying Emp ID, Reg, date, and the captured signature image.
  // R7gw — Deleted the 14 legacy Body* React renderers + inline helpers
  // (nonEmpty/txt/pick/Grid/Kv/AllergyCallout) that they were the only
  // consumers of. See the comment block above for the removed names.
  //
  // R7hr-105 / R26 — When this card represents a doctor's Initial
  // Assessment, always suppress the "NURSING INTAKE — CROSS-DISCIPLINARY"
  // block. Per R26, nurse data lives exclusively in NurseNote records and
  // must not surface inside a doctor card. Pre-R26 records may still have
  // a legacy noteDetails.nursingNabh blob persisted with imaginary form
  // defaults (Calm / Hindi / Adequate / Barthel 100 / Continent etc) —
  // those used to render here and confuse the user into thinking nursing
  // had already filled the IA. The DoctorNotesPage timeline doesn't carry
  // a nurseInitial array, so we always opt out for doctor IA noteTypes
  // (PatientPanelTabs already passes the same flag via NoteCardEmbed when
  // no nurse IA exists). All other doctor note types pass `{}` so the
  // builder behaviour stays exactly as it was — no impact on Daily
  // Progress / ICU / Procedure / Discharge / etc.
  const isDoctorIA =
    note?.noteType === "initial" || note?.noteType === "initialAssessment";
  // R7hr — render the note in the SAME PROSE arrangement the Complete IPD File
  // print uses, so the on-screen timeline matches the launch-ready file layout
  // (was card mode — a per-surface style divergence).
  const rawHtml = NURSING_TYPES.has(note.noteType)
    ? buildNurseNoteCardHtml(note, { prose: true })
    : buildDoctorNoteCardHtml(note, isDoctorIA ? { prose: true, hideNursingExtras: true } : { prose: true });
  // /uploads signature images are JWT-gated — swap them to authenticated
  // data: URLs before injecting (raw <img> tags can't send the header).
  const html = useInlinedUploadsHtml(rawHtml);
  return (
    <div
      className="tnc-body-embed"
      style={{ margin: 0 }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════
   Main exported component
   ════════════════════════════════════════════════════════════════════ */

export default function TimelineNoteCard({
  note,
  currentUserId,
  onEdit,
  onSign,
  onPrint,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!note) return null;

  const isSigned = note.status === "signed";
  const isCritical = note.isCritical || note.isCriticalEvent;
  const isDraft = note.status === "draft" || !note.status;
  const ownerId = String(note.doctor || note.createdBy || note.signedBy || "");
  const isOwner = !currentUserId || !ownerId || String(currentUserId) === ownerId;

  const t = note.createdAt || note.visitDate || note.noteDate;
  const timeStr = t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "--:--";
  const shiftLabel = (note.shift || "morning");
  const shiftCap = shiftLabel.charAt(0).toUpperCase() + shiftLabel.slice(1);

  /* Compact one-line summary when collapsed */
  const summary = (() => {
    if (note.provisionalDiagnosis) return note.provisionalDiagnosis.slice(0, 70);
    if (note.finalDiagnosis)        return note.finalDiagnosis.slice(0, 70);
    if (note.noteDetails?.provisionalDx) return note.noteDetails.provisionalDx.slice(0, 70);
    if (note.noteDetails?.chiefComplaint) return note.noteDetails.chiefComplaint.slice(0, 70);
    if (note.soap?.assessment) return note.soap.assessment.slice(0, 70);
    if (note.soap?.plan)       return note.soap.plan.slice(0, 70);
    return null;
  })();

  const canEdit = isDraft && isOwner && typeof onEdit === "function";
  const canSign = isDraft && typeof onSign === "function";

  return (
    <div
      className={`dnp-note ${isSigned ? "dnp-note--signed" : "dnp-note--draft"} ${isCritical ? "dnp-note--critical" : ""}`}
      style={{
        // R7hr(NOTE-WRAP, owner 2026-07-12) — "halka wrapper": per-type accent
        // colour dropped from the list-item chrome (left rail, time pill, dot,
        // hover tint all read these vars). Neutral slate keeps the structure
        // without the colour; the CRITICAL inset ring still comes from the
        // dnp-note--critical class, and Signed/Draft badge keeps its colour.
        "--dnp-accent": "#64748b",
        "--dnp-tint":   "#f1f5f9",
        borderLeft: "4px solid #e2e8f0",
      }}
    >
      {/* ── Left rail: time bubble + shift + dot ─────────────────── */}
      <div className="dnp-note__time">
        <div className="dnp-note__time-pill">
          <div className="dnp-note__time-hh">{timeStr}</div>
          <span className="dnp-note__time-shift">{shiftCap}</span>
        </div>
        <div className="dnp-note__time-dot" />
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="dnp-note__body">
        {/* Header row */}
        <div className="dnp-note__badge-row">
          <TypePill type={note.noteType} />
          <StatusBadge status={note.status || "draft"} />
          {isCritical && (
            <span style={{
              padding: "2px 8px", borderRadius: 4, fontSize: 9.5, fontWeight: 800, letterSpacing: ".5px",
              background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5",
            }}>⚠ CRITICAL</span>
          )}
          <DoctorMeta name={note.doctorName || note.consultantName || note.nurseName} reg={note.doctorRegNo || note.consultantRegNo || note.nurseEmployeeId} />
          {!open && summary && (
            <span style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", marginLeft: 4 }}>
              — {summary}{summary.length >= 60 ? "…" : ""}
            </span>
          )}
        </div>

        {/* Per-type body */}
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            <BodyFor note={note} />

            {/* Top-level investigations (any note) */}
            {Array.isArray(note.investigations) && note.investigations.length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>Investigations:</span>
                {note.investigations.map((inv, ii) => (
                  <span key={ii} style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: "#f5f3ff", color: "#7c3aed", border: "1px solid #c4b5fd",
                  }}>{inv}</span>
                ))}
              </div>
            )}

            {/* Top-level orders preview */}
            {Array.isArray(note.orders) && note.orders.length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>Orders ({note.orders.length}):</span>
                {note.orders.slice(0, 4).map((o, oi) => (
                  <span key={oi} style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: "#e0e7ff", color: "#4f46e5", border: "1px solid #93c5fd",
                  }}>{(o.instruction || o.drug || "—").slice(0, 36)}</span>
                ))}
                {note.orders.length > 4 && (
                  <span style={{ fontSize: 10, color: "#64748b" }}>+{note.orders.length - 4} more</span>
                )}
              </div>
            )}

            {/* Tags */}
            {Array.isArray(note.tags) && note.tags.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {note.tags.map(t => (
                  <span key={t} style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0",
                  }}>{t}</span>
                ))}
              </div>
            )}

            {/* Late-entry banner */}
            {note.lateEntry && (
              <div style={{
                padding: "5px 9px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a",
              }}>
                <i className="pi pi-clock" style={{ fontSize: 10, marginRight: 5 }} />
                LATE ENTRY {note.lateEntryReason ? `· ${note.lateEntryReason}` : ""}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Action stack (Close · Print · Edit · Sign) ──────────── */}
      <div className="dnp-note__actions" onClick={e => e.stopPropagation()}>
        <button
          className={`dnp-note__btn ${open ? "dnp-note__btn--primary" : ""}`}
          onClick={() => setOpen(o => !o)}
          title={open ? "Collapse" : "Expand"}
        >
          <i className={`pi ${open ? "pi-times" : "pi-eye"}`} style={{ fontSize: 10 }} />
          {open ? "Close" : "View"}
        </button>
        {typeof onPrint === "function" && (
          <button className="dnp-note__btn" onClick={() => onPrint(note)} title="Print">
            <i className="pi pi-print" style={{ fontSize: 10 }} /> Print
          </button>
        )}
        {canEdit && (
          <button className="dnp-note__btn dnp-note__btn--info" onClick={() => onEdit(note)} title="Edit draft">
            <i className="pi pi-pencil" style={{ fontSize: 10 }} /> Edit
          </button>
        )}
        {canSign && (
          <button className="dnp-note__btn dnp-note__btn--ok" onClick={() => onSign(note)} title="Sign">
            <i className="pi pi-check" style={{ fontSize: 10 }} /> Sign
          </button>
        )}
      </div>
    </div>
  );
}
