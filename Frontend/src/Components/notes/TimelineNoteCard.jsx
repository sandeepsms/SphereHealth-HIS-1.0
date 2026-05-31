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

/* ── Note-type accent colour palette ────────────────────────────────── */
const ACCENT = {
  daily:        { color: "#1d4ed8", tint: "#dbeafe", soft: "#eff6ff", label: "DAILY PROGRESS",      icon: "pi-file-edit" },
  progress:     { color: "#1d4ed8", tint: "#dbeafe", soft: "#eff6ff", label: "DAILY PROGRESS",      icon: "pi-file-edit" },
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
  blue:    { rule: "#1d4ed8", bg: "#eff6ff", label: "#1e40af" },
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
    amended:  { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd", text: "AMENDED" },
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

export function TypePill({ type, icon, label }) {
  const a = accentOf(type);
  return (
    <span style={{
      padding: "3px 10px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: ".5px",
      background: a.tint,
      color: a.color,
      border: `1px solid ${a.color}33`,
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
    }}>
      <i className={`pi ${icon || a.icon}`} style={{ fontSize: 10 }} />
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

/* ── Inline helpers ────────────────────────────────────────────────── */
function nonEmpty(v) {
  return v !== null && v !== undefined && v !== "" && v !== false &&
         !(Array.isArray(v) && v.length === 0);
}
function txt(v) {
  if (!nonEmpty(v)) return null;
  if (Array.isArray(v)) return v.map(x => typeof x === "object" ? (x.drug || x.drugFluid || x.name || JSON.stringify(x)) : String(x)).join(", ");
  if (typeof v === "object") {
    if ("systolic" in v) return `${v.systolic || "—"}/${v.diastolic || "—"}`;
    return Object.entries(v).filter(([, x]) => nonEmpty(x)).map(([k, x]) => `${k}: ${x}`).join(" | ") || null;
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
function pick(o, ...keys) {
  if (!o) return null;
  for (const k of keys) if (nonEmpty(o[k])) return o[k];
  return null;
}

/* Two-column grid for short factual fields */
function Grid({ children, cols = 2 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "6px 14px" }}>
      {children}
    </div>
  );
}
function Kv({ k, v }) {
  if (!nonEmpty(v)) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#64748b" }}>{k}</span>
      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600, color: "#0f172a", wordBreak: "break-word" }}>
        {txt(v)}
      </span>
    </div>
  );
}

function AllergyCallout({ allergies }) {
  if (!nonEmpty(allergies) || allergies === "NKDA" || allergies === "None") return null;
  return (
    <div style={{
      padding: "6px 10px",
      background: "#fef2f2",
      border: "1px solid #fecaca",
      borderLeft: "3px solid #dc2626",
      borderRadius: 6,
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}>
      <i className="pi pi-exclamation-triangle" style={{ color: "#dc2626", fontSize: 12 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: "#991b1b" }}>Allergies: </span>
      <span style={{ fontSize: 11, color: "#7f1d1d" }}>{txt(allergies)}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Per-type body renderers
   ════════════════════════════════════════════════════════════════════ */

function BodyDailyProgress({ note }) {
  const s = note.soap || {};
  const sections = [
    { k: "subjective", l: "S — SUBJECTIVE",  c: "blue"  },
    { k: "objective",  l: "O — OBJECTIVE",   c: "green" },
    { k: "assessment", l: "A — ASSESSMENT",  c: "amber" },
    { k: "plan",       l: "P — PLAN",        c: "teal"  },
  ].filter(x => nonEmpty(s[x.k]));
  return (
    <>
      {sections.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {sections.map(x => (
            <SubCard key={x.k} color={x.c} label={x.l}>{s[x.k]}</SubCard>
          ))}
        </div>
      )}
      {(note.provisionalDiagnosis || note.finalDiagnosis || note.workingDiagnosis) && (
        <SubCard color="violet" label="Diagnosis">
          {note.provisionalDiagnosis && <div><b>Provisional:</b> {note.provisionalDiagnosis}</div>}
          {note.workingDiagnosis && <div><b>Working:</b> {note.workingDiagnosis}</div>}
          {note.finalDiagnosis && <div><b>Final:</b> {note.finalDiagnosis}</div>}
          {note.icd10Code && <div><b>ICD-10:</b> {note.icd10Code}{note.icd10Description ? ` — ${note.icd10Description}` : ""}</div>}
        </SubCard>
      )}
      <VitalsStrip vitals={note.vitals} />
    </>
  );
}

function BodyInitialAssessment({ note }) {
  const nd = note.noteDetails || {};
  return (
    <>
      <AllergyCallout allergies={nd.allergies} />
      {nonEmpty(nd.chiefComplaint) && (
        <SubCard color="violet" label="Chief Complaint">
          {nd.chiefComplaint}{nd.duration ? ` · Duration: ${nd.duration}` : ""}{nd.admissionMode ? ` · Mode: ${nd.admissionMode}` : ""}
        </SubCard>
      )}
      {nonEmpty(nd.hpi) && <SubCard color="violet" label="History of Present Illness">{nd.hpi}</SubCard>}
      {(nd.pastMedical || nd.pastSurgical || nd.currentMeds || nd.familyHistory || nd.socialHistory) && (
        <SubCard color="slate" label="Past & Personal History">
          <Grid cols={2}>
            <Kv k="Past Medical"  v={nd.pastMedical}  />
            <Kv k="Past Surgical" v={nd.pastSurgical} />
            <Kv k="Current Meds"  v={nd.currentMeds}  />
            <Kv k="Family Hx"     v={nd.familyHistory}/>
            <Kv k="Social Hx"     v={nd.socialHistory}/>
          </Grid>
        </SubCard>
      )}
      {(nd.generalCondition || nd.pallor || nd.icterus || nd.cyanosis || nd.clubbing || nd.oedema || nd.lymphadenopathy || nd.builtNutrition) && (
        <SubCard color="teal" label="General Examination">
          <Grid cols={4}>
            <Kv k="General"        v={nd.generalCondition} />
            <Kv k="Built/Nutr"     v={nd.builtNutrition} />
            <Kv k="Pallor"         v={nd.pallor} />
            <Kv k="Icterus"        v={nd.icterus} />
            <Kv k="Cyanosis"       v={nd.cyanosis} />
            <Kv k="Clubbing"       v={nd.clubbing} />
            <Kv k="Oedema"         v={nd.oedema} />
            <Kv k="Lymphadenopathy"v={nd.lymphadenopathy} />
          </Grid>
        </SubCard>
      )}
      {(nd.resp || nd.cvs || nd.abdomen || nd.cns) && (
        <SubCard color="indigo" label="Systemic Examination">
          <Grid cols={2}>
            <Kv k="Respiratory" v={nd.resp} />
            <Kv k="CVS"         v={nd.cvs} />
            <Kv k="Abdomen"     v={nd.abdomen} />
            <Kv k="CNS / Neuro" v={nd.cns} />
          </Grid>
        </SubCard>
      )}
      {(nd.provisionalDx || nd.differentialDx || nd.finalDx || nd.icd10) && (
        <SubCard color="amber" label="Diagnosis">
          {nd.provisionalDx && <div><b>Provisional:</b> {nd.provisionalDx}</div>}
          {nd.differentialDx && <div><b>Differential:</b> {nd.differentialDx}</div>}
          {nd.finalDx && <div><b>Final:</b> {nd.finalDx}</div>}
          {nd.icd10 && <div><b>ICD-10:</b> {nd.icd10}</div>}
        </SubCard>
      )}
      {(nd.investigations || nd.managementPlan) && (
        <SubCard color="emerald" label="Investigations & Plan">
          {nonEmpty(nd.investigations) && <div><b>Investigations:</b> {txt(nd.investigations)}</div>}
          {nonEmpty(nd.managementPlan) && <div style={{ marginTop: 4 }}><b>Plan:</b> {nd.managementPlan}</div>}
        </SubCard>
      )}
      {/* Fallback: vitals captured at top-level OR inside noteDetails */}
      <VitalsStrip vitals={note.vitals || {
        bp_sys: nd.bp_sys, bp_dia: nd.bp_dia, pulse: nd.pulse, temp: nd.temp,
        spo2: nd.spo2, rr: nd.rr, bsl: nd.bsl,
      }} />
    </>
  );
}

function BodyProcedure({ note }) {
  const nd = note.noteDetails || {};
  return (
    <>
      {(nd.procedureName || nd.indication || nd.laterality || nd.surgeon || nd.assistant || nd.anaesthesia || nd.position || nd.consentObtained) && (
        <SubCard color="teal" label="Procedure Details">
          <Grid cols={2}>
            <Kv k="Procedure"    v={nd.procedureName} />
            <Kv k="Indication"   v={nd.indication} />
            <Kv k="Laterality"   v={nd.laterality} />
            <Kv k="Surgeon"      v={nd.surgeon} />
            <Kv k="Assistant"    v={nd.assistant} />
            <Kv k="Anaesthesia"  v={nd.anaesthesia} />
            <Kv k="Anaesthetist" v={nd.anaesthetist} />
            <Kv k="Position"     v={nd.position} />
            <Kv k="Consent"      v={nd.consentObtained} />
            <Kv k="Time"         v={nd.time} />
          </Grid>
        </SubCard>
      )}
      {nonEmpty(nd.technique) && <SubCard color="indigo" label="Technique">{nd.technique}</SubCard>}
      {nonEmpty(nd.findings) && <SubCard color="amber" label="Findings">{nd.findings}</SubCard>}
      {(nd.complications || nd.bloodLoss || nd.specimenSent || nd.specimenType) && (
        <SubCard color="slate" label="Outcome">
          <Grid cols={2}>
            <Kv k="Complications" v={nd.complications} />
            <Kv k="Blood Loss"    v={nd.bloodLoss} />
            <Kv k="Specimen Sent" v={nd.specimenSent} />
            <Kv k="Specimen Type" v={nd.specimenType} />
          </Grid>
        </SubCard>
      )}
      {nonEmpty(nd.postInstructions) && <SubCard color="emerald" label="Post-procedure Instructions">{nd.postInstructions}</SubCard>}
    </>
  );
}

function BodyPreop({ note }) {
  const nd = note.noteDetails || {};
  const asaTone = ({ "I":"green","II":"teal","III":"amber","IV":"crimson","V":"rose" })[String(nd.asaGrade || "").replace(/[^IVX]/g, "")] || "slate";
  return (
    <>
      {(nd.procedure || nd.indication || nd.preopDiagnosis || nd.asaGrade || nd.plannedAnaesthesia || nd.bloodGroup) && (
        <SubCard color="slate" label="Planned Procedure">
          <Grid cols={2}>
            <Kv k="Procedure"          v={nd.procedure} />
            <Kv k="Indication"         v={nd.indication} />
            <Kv k="Pre-op Diagnosis"   v={nd.preopDiagnosis} />
            <Kv k="Planned Anaesthesia"v={nd.plannedAnaesthesia} />
            <Kv k="Blood Group"        v={nd.bloodGroup} />
            <Kv k="Cross-match"        v={nd.crossMatch} />
          </Grid>
          {nd.asaGrade && (
            <div style={{ marginTop: 6 }}>
              <ChipRow chips={[{ label: `ASA ${nd.asaGrade}`, tone: asaTone }]} />
            </div>
          )}
        </SubCard>
      )}
      {(nd.cbcReviewed || nd.ptReviewed || nd.ecgReviewed || nd.cxrReviewed || nd.echoReviewed || nd.lftsReviewed || nd.rftReviewed) && (
        <SubCard color="emerald" label="Pre-op Lab Reviews">
          <ChipRow chips={[
            nd.cbcReviewed   && { label: "CBC ✓",   tone: "emerald" },
            nd.ptReviewed    && { label: "PT/APTT ✓", tone: "emerald" },
            nd.ecgReviewed   && { label: "ECG ✓",   tone: "emerald" },
            nd.cxrReviewed   && { label: "CXR ✓",   tone: "emerald" },
            nd.echoReviewed  && { label: "Echo ✓",  tone: "emerald" },
            nd.lftsReviewed  && { label: "LFTs ✓",  tone: "emerald" },
            nd.rftReviewed   && { label: "RFTs ✓",  tone: "emerald" },
          ].filter(Boolean)} />
        </SubCard>
      )}
      {(nd.consentObtained || nd.fastingStatus || nd.surgeon || nd.anaesthetist) && (
        <SubCard color="teal" label="Pre-op Checklist">
          <Grid cols={2}>
            <Kv k="Consent"       v={nd.consentObtained} />
            <Kv k="Fasting"       v={nd.fastingStatus} />
            <Kv k="Surgeon"       v={nd.surgeon} />
            <Kv k="Anaesthetist"  v={nd.anaesthetist} />
            <Kv k="Comorbidities" v={nd.comorbidities} />
          </Grid>
        </SubCard>
      )}
      <AllergyCallout allergies={nd.allergies} />
      {nonEmpty(nd.preopOrders) && <SubCard color="indigo" label="Pre-op Orders">{nd.preopOrders}</SubCard>}
    </>
  );
}

function BodyPostop({ note }) {
  const nd = note.noteDetails || {};
  const hasComplications = nonEmpty(nd.complications) && String(nd.complications).toLowerCase() !== "nil" && String(nd.complications).toLowerCase() !== "none";
  return (
    <>
      {(nd.procedurePerformed || nd.operativeFindings || nd.surgeon || nd.anaesthesia || nd.startTime || nd.endTime) && (
        <SubCard color="emerald" label="Operative Details">
          <Grid cols={2}>
            <Kv k="Procedure Performed" v={nd.procedurePerformed} />
            <Kv k="Surgeon"             v={nd.surgeon} />
            <Kv k="Anaesthetist"        v={nd.anaesthetist} />
            <Kv k="Anaesthesia"         v={nd.anaesthesia} />
            <Kv k="Start Time"          v={nd.startTime} />
            <Kv k="End Time"            v={nd.endTime} />
          </Grid>
          {nonEmpty(nd.operativeFindings) && (
            <div style={{ marginTop: 6 }}><b>Findings: </b>{nd.operativeFindings}</div>
          )}
        </SubCard>
      )}
      {(nd.bloodLoss || nd.transfusion || nd.fluidsGiven || nd.urineOutput || nd.specimenSent || nd.specimenType) && (
        <SubCard color="indigo" label="Fluids & Specimens">
          <Grid cols={2}>
            <Kv k="Blood Loss"      v={nd.bloodLoss} />
            <Kv k="Transfusion"     v={nd.transfusion} />
            <Kv k="Fluids Given"    v={nd.fluidsGiven} />
            <Kv k="Urine Output"    v={nd.urineOutput} />
            <Kv k="Specimen Sent"   v={nd.specimenSent} />
            <Kv k="Specimen Type"   v={nd.specimenType} />
          </Grid>
        </SubCard>
      )}
      {hasComplications && (
        <SubCard color="crimson" label="Complications">
          <span style={{ fontStyle: "italic", color: "#991b1b" }}>{nd.complications}</span>
        </SubCard>
      )}
      {(nd.postopDiagnosis || nd.conditionLeavingOT) && (
        <SubCard color="amber" label="Post-op Status">
          <Grid cols={2}>
            <Kv k="Post-op Dx"      v={nd.postopDiagnosis} />
            <Kv k="Condition (OT)"  v={nd.conditionLeavingOT} />
          </Grid>
        </SubCard>
      )}
      {nonEmpty(nd.recoveryInstructions) && <SubCard color="teal" label="Recovery Instructions">{nd.recoveryInstructions}</SubCard>}
      {nonEmpty(nd.postopOrders) && <SubCard color="slate" label="Post-op Orders">{nd.postopOrders}</SubCard>}
      <VitalsStrip vitals={note.vitals} />
    </>
  );
}

function BodyConsult({ note }) {
  const nd = note.noteDetails || {};
  return (
    <>
      {(nd.consultantName || nd.speciality || nd.referredBy || nd.consultantRegNo) && (
        <SubCard color="indigo" label="Consultation">
          <Grid cols={2}>
            <Kv k="Consultant"   v={nd.consultantName} />
            <Kv k="Speciality"   v={nd.speciality} />
            <Kv k="Reg No"       v={nd.consultantRegNo} />
            <Kv k="Referred By"  v={nd.referredBy} />
          </Grid>
        </SubCard>
      )}
      {nonEmpty(nd.reason) && <SubCard color="slate" label="Reason for Consult">{nd.reason}</SubCard>}
      {nonEmpty(nd.clinicalSummary) && <SubCard color="blue" label="Clinical Summary">{nd.clinicalSummary}</SubCard>}
      {nonEmpty(nd.findings) && <SubCard color="amber" label="Findings">{nd.findings}</SubCard>}
      {nonEmpty(nd.impression) && <SubCard color="violet" label="Impression / Opinion">{nd.impression}</SubCard>}
      {nonEmpty(nd.recommendations) && <SubCard color="emerald" label="Recommendations">{nd.recommendations}</SubCard>}
      {nonEmpty(nd.followUp) && <SubCard color="teal" label="Follow-up">{nd.followUp}</SubCard>}
      {(nd.consultantName || nd.speciality) && (
        <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", paddingTop: 4 }}>
          Consulted by {nd.consultantName || "—"}{nd.speciality ? ` (${nd.speciality})` : ""}
        </div>
      )}
    </>
  );
}

function BodyEmergency({ note }) {
  const nd = note.noteDetails || {};
  const triage = String(nd.triageCategory || nd.triage || "").toUpperCase();
  const triageTone = triage === "RED" ? "crimson" : triage === "YELLOW" ? "amber" : triage === "GREEN" ? "emerald" : "slate";
  return (
    <>
      {triage && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>Triage:</span>
          <ChipRow chips={[{ label: triage, tone: triageTone }]} />
        </div>
      )}
      {(nd.modeOfArrival || nd.timeFirstContact || nd.gcs) && (
        <SubCard color="crimson" label="Triage Snapshot">
          <Grid cols={3}>
            <Kv k="Mode of Arrival"  v={nd.modeOfArrival} />
            <Kv k="First Contact"    v={nd.timeFirstContact} />
            <Kv k="GCS"              v={nd.gcs} />
          </Grid>
        </SubCard>
      )}
      {nonEmpty(nd.chiefComplaint) && <SubCard color="amber" label="Chief Complaint">{nd.chiefComplaint}</SubCard>}
      <VitalsStrip vitals={note.vitals || nd.vitals} />
      {nonEmpty(nd.disposition) && (
        <SubCard color="indigo" label="Disposition">{nd.disposition}</SubCard>
      )}
    </>
  );
}

function BodyDischarge({ note }) {
  const nd = note.noteDetails || {};
  const meds = nd.dischargeMedications || nd.medications;
  return (
    <>
      {nonEmpty(note.finalDiagnosis || nd.finalDiagnosis) && (
        <SubCard color="emerald" label="Final Diagnosis">{note.finalDiagnosis || nd.finalDiagnosis}</SubCard>
      )}
      {nonEmpty(nd.courseInHospital) && <SubCard color="blue" label="Course in Hospital">{nd.courseInHospital}</SubCard>}
      {nonEmpty(nd.proceduresPerformed) && <SubCard color="teal" label="Procedures Performed">{txt(nd.proceduresPerformed)}</SubCard>}
      {nonEmpty(nd.dischargeCondition) && <SubCard color="amber" label="Discharge Condition">{nd.dischargeCondition}</SubCard>}
      {Array.isArray(meds) && meds.length > 0 && (
        <SubCard color="indigo" label={`Discharge Medications (${meds.length})`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 4 }}>
            {meds.map((m, i) => (
              <div key={i} style={{ fontSize: 11, padding: "3px 6px", background: "#fff", borderRadius: 4, border: "1px solid #e2e8f0" }}>
                <b>{m.drug || m.name || "—"}</b>
                {m.dose ? ` · ${m.dose}` : ""}{m.route ? ` · ${m.route}` : ""}{m.frequency ? ` · ${m.frequency}` : ""}
                {m.duration ? ` · ${m.duration}` : ""}
              </div>
            ))}
          </div>
        </SubCard>
      )}
      {nonEmpty(nd.dischargeAdvice || nd.advice) && (
        <SubCard color="violet" label="Discharge Advice">{nd.dischargeAdvice || nd.advice}</SubCard>
      )}
      {nonEmpty(nd.followUpDate || nd.followUp) && (
        <SubCard color="sky" label="Follow-up">{txt(nd.followUpDate || nd.followUp)}</SubCard>
      )}
    </>
  );
}

function BodyReferral({ note }) {
  const nd = note.noteDetails || {};
  return (
    <>
      {(nd.referredTo || nd.receivingHospital || nd.receivingSpecialist) && (
        <SubCard color="sky" label="Referred To">
          <Grid cols={2}>
            <Kv k="Hospital"    v={nd.referredTo || nd.receivingHospital} />
            <Kv k="Specialist"  v={nd.receivingSpecialist} />
            <Kv k="Contact"     v={nd.receivingContact} />
          </Grid>
        </SubCard>
      )}
      {nonEmpty(nd.reason) && <SubCard color="amber" label="Reason for Referral">{nd.reason}</SubCard>}
      {nonEmpty(nd.clinicalSummary) && <SubCard color="indigo" label="Clinical Summary">{nd.clinicalSummary}</SubCard>}
      {nonEmpty(nd.investigations) && <SubCard color="emerald" label="Investigations Carried">{txt(nd.investigations)}</SubCard>}
      {nonEmpty(nd.treatmentGiven) && <SubCard color="teal" label="Treatment Given">{nd.treatmentGiven}</SubCard>}
    </>
  );
}

function BodyDeath({ note }) {
  const nd = note.noteDetails || {};
  return (
    <>
      <div style={{
        background: "#0f172a",
        color: "#fff",
        padding: "6px 12px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: ".8px",
        textTransform: "uppercase",
      }}>Death Summary {nd.dateTime ? `· ${nd.dateTime}` : ""}</div>
      {(nd.causeDeath1 || nd.causeDeath2 || nd.causeDeath3 || nd.contributing) && (
        <SubCard color="slate" label="Cause of Death">
          {nd.causeDeath1 && <div><b>Immediate:</b> {nd.causeDeath1}</div>}
          {nd.causeDeath2 && <div><b>Antecedent:</b> {nd.causeDeath2}</div>}
          {nd.causeDeath3 && <div><b>Underlying:</b> {nd.causeDeath3}</div>}
          {nd.contributing && <div><b>Contributing:</b> {nd.contributing}</div>}
        </SubCard>
      )}
      {nonEmpty(note.finalDiagnosis) && <SubCard color="amber" label="Final Diagnosis">{note.finalDiagnosis}</SubCard>}
      {nonEmpty(nd.sequenceOfEvents) && <SubCard color="indigo" label="Sequence of Events">{nd.sequenceOfEvents}</SubCard>}
      {(nd.modeOfDeath || nd.placeOfDeath || nd.dnrInPlace || nd.mlc || nd.pmAdvised || nd.postMortemDone) && (
        <SubCard color="slate" label="Clinical & Administrative">
          <Grid cols={2}>
            <Kv k="Mode of Death"     v={nd.modeOfDeath} />
            <Kv k="Place of Death"    v={nd.placeOfDeath} />
            <Kv k="DNR in Place"      v={nd.dnrInPlace} />
            <Kv k="MLC"               v={nd.mlc} />
            <Kv k="PM Advised"        v={nd.pmAdvised} />
            <Kv k="PM Done"           v={nd.postMortemDone} />
          </Grid>
        </SubCard>
      )}
      {(nd.familyInformed || nd.familyInformedBy || nd.familyInformedTime || nd.bodyHandedOverTo || nd.certificateIssued || nd.deathCertificateNumber) && (
        <SubCard color="violet" label="Family / Certificate">
          <Grid cols={2}>
            <Kv k="Family Informed"      v={nd.familyInformed} />
            <Kv k="Informed By"          v={nd.familyInformedBy} />
            <Kv k="Informed Time"        v={nd.familyInformedTime} />
            <Kv k="Body Handed Over To"  v={nd.bodyHandedOverTo} />
            <Kv k="Certificate Issued"   v={nd.certificateIssued} />
            <Kv k="Certificate No"       v={nd.deathCertificateNumber} />
            <Kv k="Issued At"            v={nd.deathCertificateIssuedAt} />
          </Grid>
        </SubCard>
      )}
    </>
  );
}

function BodyICU({ note }) {
  const nd = note.noteDetails || {};
  return (
    <>
      {(nd.ventMode || nd.fio2 || nd.peep || nd.tv || nd.ventRR || nd.pip) && (
        <SubCard color="crimson" label="Ventilator Settings">
          <Grid cols={3}>
            <Kv k="Mode"    v={nd.ventMode} />
            <Kv k="FiO₂"    v={nd.fio2 && `${nd.fio2}%`} />
            <Kv k="PEEP"    v={nd.peep && `${nd.peep} cmH₂O`} />
            <Kv k="TV"      v={nd.tv && `${nd.tv} mL`} />
            <Kv k="Vent RR" v={nd.ventRR} />
            <Kv k="PIP"     v={nd.pip} />
          </Grid>
        </SubCard>
      )}
      {(nd.map || nd.cvp || nd.rassScore || nd.bpsScore) && (
        <SubCard color="amber" label="Monitoring">
          <Grid cols={4}>
            <Kv k="MAP"  v={nd.map} />
            <Kv k="CVP"  v={nd.cvp} />
            <Kv k="RASS" v={nd.rassScore} />
            <Kv k="BPS"  v={nd.bpsScore} />
          </Grid>
        </SubCard>
      )}
      {(nd.sedation || nd.vasopressors || nd.vasopressorDetail) && (
        <SubCard color="indigo" label="Sedation & Vasopressors">
          <Grid cols={2}>
            <Kv k="Sedation"     v={nd.sedation} />
            <Kv k="Vasopressors" v={nd.vasopressors} />
            <Kv k="Detail"       v={nd.vasopressorDetail} />
          </Grid>
        </SubCard>
      )}
      {(nd.neuro || nd.cvs || nd.resp || nd.renal || nd.gi || nd.haem || nd.infective) && (
        <SubCard color="teal" label="System Assessment">
          <Grid cols={2}>
            <Kv k="Neuro"     v={nd.neuro} />
            <Kv k="CVS"       v={nd.cvs} />
            <Kv k="Resp"      v={nd.resp} />
            <Kv k="Renal"     v={nd.renal} />
            <Kv k="GI"        v={nd.gi} />
            <Kv k="Haem"      v={nd.haem} />
            <Kv k="Infective" v={nd.infective} />
          </Grid>
        </SubCard>
      )}
      {nonEmpty(nd.dailyGoals) && <SubCard color="emerald" label="Daily Goals">{nd.dailyGoals}</SubCard>}
      <VitalsStrip vitals={note.vitals} />
    </>
  );
}

function BodyAmendment({ note }) {
  const nd = note.noteDetails || {};
  return (
    <>
      <SubCard color="amber" label="Amendment">
        {nd.originalNoteId && <div><b>Original Note:</b> {String(nd.originalNoteId)}</div>}
        {nd.correction && <div style={{ marginTop: 4 }}><b>Correction:</b> {nd.correction}</div>}
        {nd.reason && <div style={{ marginTop: 4 }}><b>Reason:</b> {nd.reason}</div>}
        {nd.witness && <div style={{ marginTop: 4 }}><b>Witness:</b> {nd.witness}</div>}
      </SubCard>
    </>
  );
}

function BodyNursing({ note }) {
  // NurseNotes stores typed payload under noteData (sometimes wrapped under
  // a module key matching noteType). Walk both shapes.
  const nd = note.noteData || note.noteDetails || {};
  // Some nurse modules place their payload at nd[noteType]; flatten so the
  // renderer below can find common fields by key.
  const inner = (nd && note.noteType && nd[note.noteType] && typeof nd[note.noteType] === "object")
    ? { ...nd, ...nd[note.noteType] } : nd;
  const NICE = {
    careActivities: "Care Activities", observations: "Observations", patientResponse: "Patient Response",
    handover: "Handover", handoverNotes: "Handover", fallRisk: "Fall Risk", morseScore: "Morse Score",
    bradenScore: "Braden Score", painScore: "Pain Score", painLevel: "Pain Level", painLocation: "Pain Location",
    interventions: "Interventions", site: "Site", woundType: "Wound Type", drainage: "Drainage",
    dressing: "Dressing", gcsTotal: "GCS Total", eyeOpening: "Eye Opening", verbalResponse: "Verbal Response",
    motorResponse: "Motor Response", oralIntake: "Oral Intake", urineOutput: "Urine Output",
    stoolOutput: "Stool Output", drainOutput: "Drain Output", ivIntake: "IV Intake",
    bloodGroup: "Blood Group", unitNumber: "Unit Number", crossMatched: "Cross-matched",
    pretransVitals: "Pre-transfusion Vitals", reaction: "Reaction",
    fluidName: "Fluid", rate: "Rate", siteOfAccess: "Site",
  };
  const HEAD_FIELDS = ["careActivities","interventions","observations","patientResponse"];
  const skipKeys = new Set([...HEAD_FIELDS, "vitals", note.noteType]);
  const flatKeys = Object.entries(inner).filter(([k, v]) => !skipKeys.has(k) && nonEmpty(v) && typeof v !== "object");
  const objKeys  = Object.entries(inner).filter(([k, v]) => !skipKeys.has(k) && nonEmpty(v) && typeof v === "object" && !Array.isArray(v));
  return (
    <>
      {(note.shift || inner.shift) && (
        <ChipRow chips={[{ label: `${(note.shift || inner.shift).toString().toUpperCase()} SHIFT`, tone: "teal" }]} />
      )}
      {HEAD_FIELDS.filter(k => nonEmpty(inner[k])).map(k => (
        <SubCard key={k} color="teal" label={NICE[k] || k}>{txt(inner[k])}</SubCard>
      ))}
      {flatKeys.length > 0 && (
        <SubCard color="blue" label="Details">
          <Grid cols={3}>
            {flatKeys.map(([k, v]) => (
              <Kv key={k} k={NICE[k] || k.replace(/([A-Z])/g, " $1").trim()} v={v} />
            ))}
          </Grid>
        </SubCard>
      )}
      {objKeys.map(([k, v]) => (
        <SubCard key={k} color="indigo" label={NICE[k] || k.replace(/([A-Z])/g, " $1").trim()}>
          <Grid cols={3}>
            {Object.entries(v).filter(([, vv]) => nonEmpty(vv)).map(([kk, vv]) => (
              <Kv key={kk} k={NICE[kk] || kk.replace(/([A-Z])/g, " $1").trim()} v={vv} />
            ))}
          </Grid>
        </SubCard>
      ))}
      {nonEmpty(note.remarks) && <SubCard color="slate" label="Remarks">{note.remarks}</SubCard>}
      <VitalsStrip vitals={note.vitals || inner.vitals} />
    </>
  );
}

/* Fallback: render any free-form note as a single SubCard with the
   content, optional vitals strip. Used for unknown / generic note types. */
function BodyFreeNote({ note }) {
  const nd = note.noteDetails;
  const content = pick(note, "content", "notes", "remarks") ||
                  (nd && typeof nd === "object" ? pick(nd, "content", "notes", "text", "addNote", "freeNote") : null);
  const text = content || (nd && typeof nd === "string" ? nd : null) ||
               (nd && typeof nd === "object" ? Object.entries(nd).filter(([, v]) => nonEmpty(v)).map(([k, v]) => `${k}: ${txt(v)}`).join("\n") : null);
  return (
    <>
      {text && <SubCard color="slate" label="Note">{text}</SubCard>}
      {(note.provisionalDiagnosis || note.finalDiagnosis || note.workingDiagnosis) && (
        <SubCard color="violet" label="Diagnosis">
          {note.provisionalDiagnosis && <div><b>Provisional:</b> {note.provisionalDiagnosis}</div>}
          {note.workingDiagnosis && <div><b>Working:</b> {note.workingDiagnosis}</div>}
          {note.finalDiagnosis && <div><b>Final:</b> {note.finalDiagnosis}</div>}
        </SubCard>
      )}
      <VitalsStrip vitals={note.vitals} />
    </>
  );
}

/* Body renderer dispatcher ------------------------------------------- */
function BodyFor({ note }) {
  const t = (note.noteType || "general").toLowerCase();
  if (t === "daily" || t === "progress" || t === "general") return <BodyDailyProgress note={note} />;
  if (t === "initial" || t === "assessment" || t === "admission" || t === "initial-assessment") return <BodyInitialAssessment note={note} />;
  if (t === "procedure" || t === "operative" || t === "op-note") return <BodyProcedure note={note} />;
  if (t === "preop" || t === "pre-op" || t === "pre-operative") return <BodyPreop note={note} />;
  if (t === "postop" || t === "post-op" || t === "post-operative") return <BodyPostop note={note} />;
  if (t === "consultation" || t === "consult-reply" || t === "specialist-opinion") return <BodyConsult note={note} />;
  if (t === "emergency" || t === "er-triage" || t === "emergency-triage") return <BodyEmergency note={note} />;
  if (t === "discharge" || t === "discharge-note") return <BodyDischarge note={note} />;
  if (t === "referral" || t === "referral-note") return <BodyReferral note={note} />;
  if (t === "death" || t === "death-summary") return <BodyDeath note={note} />;
  if (t === "icu") return <BodyICU note={note} />;
  if (t === "amendment") return <BodyAmendment note={note} />;
  if (NURSING_TYPES.has(note.noteType)) return <BodyNursing note={note} />;
  return <BodyFreeNote note={note} />;
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

  const accent = accentOf(note.noteType);
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
        "--dnp-accent": accent.color,
        "--dnp-tint":   accent.tint,
        borderLeft: `4px solid ${accent.color}`,
      }}
    >
      {/* ── Left rail: time bubble + shift + dot ─────────────────── */}
      <div className="dnp-note__time">
        <div className="dnp-note__time-pill">
          <div className="dnp-note__time-hh">{timeStr}</div>
          <span className="dnp-note__time-shift">{shiftCap}</span>
        </div>
        <div className="dnp-note__time-dot" style={{ background: accent.color }} />
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
                    background: "#dbeafe", color: "#1d4ed8", border: "1px solid #93c5fd",
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
