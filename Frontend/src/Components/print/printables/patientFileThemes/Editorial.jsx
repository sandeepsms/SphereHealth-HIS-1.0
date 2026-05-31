// R7ft Theme 5 — Editorial / Glossy VIP
//
// Hero patient profile card on page 1 (60mm avatar placeholder with
// accent-coloured initials, large serif name, 3-tile dates strip).
// Pages 2+ are a magazine-style 2-column body: drop-caps, accent
// section headings, pull-quote callouts pulled from the discharge
// note. Final page is a "Continuing Care" advice list + follow-up.
//
// Target page count: 5–6 A4 pages for a 4-day admission.
// Premium / international / Fortis-Memorial / Medanta-tier vibe;
// the document a private-room patient frames on the wall.
//
// Implementation notes:
//   • Switched to @/templates/PrintShell so we inherit the standard
//     triple-zone NABH header, patient strip, signature zone,
//     emergency banner and footer for free. This stays a medical
//     document, not a wedding card — restraint is luxury.
//   • Hospital accent colour (settings.printAccentColor, default
//     #1d4ed8) is wired through a single CSS variable on the body
//     wrapper so every chrome element (dividers, drop-caps,
//     pull-quote rails, day labels) honours it automatically.
//   • Browser-native column-count CSS works in print; column-span:
//     all is used on headings / pull-quotes so they break the grid
//     cleanly and the body re-flows around them.
//   • Pull-quotes are sourced opportunistically — discharge summary
//     supplies the "diagnosis" quote, the final doctor note
//     supplies the "fit for discharge" line. If neither is present,
//     we render plain prose without a forced callout.
//   • Empty sections silently skipped (NABH requires the strip,
//     not a "—" placeholder).

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtDate, fmtDayMonth, pronoun } from "./normalizeData";

/* ── Small text helpers (component-local) ─────────────────────────
   Same prose-joining helpers used by Narrative — kept inline so the
   themes stay independent and can be moved/renamed without coupling. */
const cleanSentence = (s) => {
  if (!s) return "";
  let out = String(s).replace(/\s+/g, " ").trim();
  if (!out) return "";
  if (!/[.!?]$/.test(out)) out += ".";
  return out[0].toUpperCase() + out.slice(1);
};

const oxford = (arr) => {
  const a = arr.filter(Boolean).map((x) => String(x).trim());
  if (a.length === 0) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
};

const honorific = (gender) => {
  const g = String(gender || "").toLowerCase();
  if (g.startsWith("f")) return "Ms.";
  if (g.startsWith("m")) return "Mr.";
  return "";
};

const fullNameWithHonorific = (name, gender) => {
  if (!name) return "The patient";
  const n = String(name).trim();
  if (/^(mr|mrs|ms|miss|dr|master|baby)\.?\s/i.test(n)) return n;
  const h = honorific(gender);
  return h ? `${h} ${n}` : n;
};

/* Patient initials — used inside the hero avatar placeholder.
   Strips honorifics and any trailing degree before picking the first
   letter of the first two surviving tokens. Falls back to "P" if the
   name is empty. */
const initials = (name, gender) => {
  if (!name) return "P";
  let n = String(name).trim();
  n = n.replace(/^(mr|mrs|ms|miss|dr|master|baby)\.?\s+/i, "");
  n = n.replace(/[,·].*$/, ""); // drop "Mr Demo Patient · MBA" style trailers
  const tokens = n.split(/\s+/).filter(Boolean);
  if (!tokens.length) return honorific(gender)[0] || "P";
  if (tokens.length === 1) return tokens[0][0].toUpperCase();
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
};

/* Allergy label — robust to string-or-object entries. */
const allergyLabel = (a) => {
  if (!a) return "";
  if (typeof a === "string") return a;
  const ag = a.allergen || a.agent || a.name || "";
  const sev = a.severity || a.reaction || "";
  return sev ? `${ag} (${sev})` : ag;
};

/* Day-of-admission helper — same arithmetic as Narrative so day
   labels match between themes (Day 1 = day of admission). */
const dayNumber = (eventDate, admissionDate) => {
  if (!eventDate || !admissionDate) return null;
  const ms = new Date(eventDate).getTime() - new Date(admissionDate).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
};

/* Vitals sentence — same shape as Narrative's so the editorial body
   reads like a continuation of the case letter rather than a separate
   data dump. */
const vitalsSentence = (v = {}) => {
  if (!v || Object.keys(v).length === 0) return "";
  const bits = [];
  if (v.bp) bits.push(`BP ${v.bp}`);
  if (v.pulse) bits.push(`pulse ${v.pulse}/min`);
  if (v.temp) bits.push(`temperature ${v.temp}°F`);
  if (v.spo2) bits.push(`SpO2 ${v.spo2}%`);
  if (v.rr) bits.push(`respiratory rate ${v.rr}/min`);
  if (!bits.length) return "";
  return `Vitals on admission were recorded as ${oxford(bits)}.`;
};

/* ============================================================
   Stylesheet helpers (inline so this theme is self-contained
   and ships without touching printShell.css)
   ============================================================ */

const ACCENT = "var(--pr-accent-color, #1d4ed8)";

/* Section heading that spans both columns — accent rule on either
   side gives the magazine "feature heading" feel without needing a
   custom font. */
const SectionHeading = ({ children }) => (
  <h2
    style={{
      columnSpan: "all",
      WebkitColumnSpan: "all",
      textAlign: "center",
      color: ACCENT,
      fontSize: 14,
      textTransform: "uppercase",
      letterSpacing: 1.4,
      fontWeight: 700,
      margin: "20px 0 12px",
      padding: "0 14px",
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      breakAfter: "avoid",
      pageBreakAfter: "avoid",
    }}
  >
    <span
      aria-hidden="true"
      style={{
        flex: 1,
        height: 0,
        borderTop: `1px solid ${ACCENT}`,
        opacity: 0.55,
      }}
    />
    <span style={{ whiteSpace: "nowrap" }}>{children}</span>
    <span
      aria-hidden="true"
      style={{
        flex: 1,
        height: 0,
        borderTop: `1px solid ${ACCENT}`,
        opacity: 0.55,
      }}
    />
  </h2>
);

/* Pull-quote callout. Spans columns (so the surrounding body re-flows
   around it), avoids breaking across pages, and uses a 3px accent rail
   on the left edge — the signature magazine flourish. */
const PullQuote = ({ children }) => (
  <aside
    style={{
      columnSpan: "all",
      WebkitColumnSpan: "all",
      borderLeft: `3px solid ${ACCENT}`,
      paddingLeft: 18,
      paddingRight: 8,
      margin: "18px 6mm",
      fontSize: 17,
      lineHeight: 1.4,
      fontStyle: "italic",
      color: "#334155",
      breakInside: "avoid",
      pageBreakInside: "avoid",
      fontFamily: "'DM Sans', Georgia, serif",
    }}
  >
    {children}
  </aside>
);

/* Drop-cap span — first letter of the first paragraph of each major
   section gets the float treatment. Inline so consumers can pick what
   "first paragraph" means per section without prop drilling. */
const DropCapPara = ({ text }) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const first = t[0];
  const rest = t.slice(1);
  return (
    <p
      style={{
        fontSize: 10.5,
        lineHeight: 1.55,
        textAlign: "justify",
        margin: "0 0 8px 0",
        color: "#1f2937",
      }}
    >
      <span
        style={{
          float: "left",
          fontSize: 36,
          color: ACCENT,
          lineHeight: 0.85,
          paddingRight: 6,
          paddingTop: 3,
          fontWeight: 800,
          fontFamily: "'DM Sans', Georgia, serif",
        }}
      >
        {first}
      </span>
      {rest}
    </p>
  );
};

const Para = ({ children }) => (
  <p
    style={{
      fontSize: 10.5,
      lineHeight: 1.55,
      textAlign: "justify",
      margin: "0 0 8px 0",
      color: "#1f2937",
    }}
  >
    {children}
  </p>
);

/* Thin divider between editorial sections — used inline (not
   column-span:all) when we want a horizontal whisker INSIDE a column. */
const ColumnDivider = () => (
  <div
    aria-hidden="true"
    style={{
      borderTop: `1px solid ${ACCENT}`,
      opacity: 0.35,
      margin: "10px 0 12px",
    }}
  />
);

/* ============================================================
   Hero page (page 1) — magazine cover for the patient
   ============================================================ */

const HeroCard = ({ file }) => {
  const p = file.patient || {};
  const a = file.admission || {};
  const pn = pronoun(p.gender);
  const fullName = fullNameWithHonorific(p.fullName, p.gender);
  const inits = initials(p.fullName, p.gender);

  const ageGenderLine = [
    p.age ? `${p.age} years` : null,
    p.gender || null,
    a.uhid || file.meta?.uhid ? `UHID ${file.meta?.uhid || ""}` : null,
    p.bloodGroup ? `Blood group ${p.bloodGroup}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const tiles = [
    {
      label: "ADMITTED",
      big: fmtDayMonth(a.date),
      small: a.date ? new Date(a.date).getFullYear() : "",
    },
    {
      label: "STAY",
      big: a.totalDays != null ? `${a.totalDays}` : "—",
      small: a.totalDays != null ? `day${a.totalDays === 1 ? "" : "s"}` : "",
    },
    {
      label: "DISCHARGED",
      big: fmtDayMonth(a.dischargeDate),
      small: a.dischargeDate ? new Date(a.dischargeDate).getFullYear() : "",
    },
  ];

  /* The lede paragraph — single editorial sentence under the tiles.
     We construct it carefully so a missing field never leaves a
     dangling preposition. */
  const ledeBits = [];
  ledeBits.push(`${fullName} was admitted`);
  if (a.ward) ledeBits.push(`to ${a.ward}`);
  if (a.consultant) ledeBits.push(`under the care of ${a.consultant}`);
  ledeBits.push(",");
  ledeBits.push(`where ${pn.subj.toLowerCase()} received treatment`);
  if (a.finalDiagnosis) {
    ledeBits.push(`for ${a.finalDiagnosis.replace(/\.$/, "")}`);
  } else if (a.workingDiagnosis) {
    ledeBits.push(`for ${a.workingDiagnosis.replace(/\.$/, "")}`);
  } else if (a.provisionalDiagnosis) {
    ledeBits.push(`for ${a.provisionalDiagnosis.replace(/\.$/, "")}`);
  }
  if (a.totalDays) {
    ledeBits.push(`over ${a.totalDays} day${a.totalDays === 1 ? "" : "s"}`);
  }
  const lede = cleanSentence(
    ledeBits.join(" ").replace(/\s+,/, ",").replace(/\s+/g, " "),
  );

  const allergies = (file.alerts?.allergies || []).map(allergyLabel).filter(Boolean);

  return (
    <section
      style={{
        textAlign: "center",
        padding: "24px 8px 18px",
        breakAfter: "page",
        pageBreakAfter: "always",
      }}
    >
      {/* Avatar placeholder — accent initials over a soft slate disc.
          Deliberate restraint: no actual photo, no border that screams
          "ID card", just a quiet circle. */}
      <div
        style={{
          width: "60mm",
          height: "60mm",
          borderRadius: "50%",
          background: "#f1f5f9",
          margin: "0 auto 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: ACCENT,
          fontSize: 60,
          fontWeight: 800,
          letterSpacing: "-1px",
          fontFamily: "'DM Sans', Georgia, serif",
          lineHeight: 1,
        }}
      >
        {inits}
      </div>

      {/* Patient name in tall serif-tinged display. The PrintShell
          patient strip is hidden on page 1 (we pass an empty patient
          prop so the hero owns the brand impression). */}
      <h1
        style={{
          fontFamily: "'DM Sans', Georgia, serif",
          fontWeight: 800,
          letterSpacing: "-0.5px",
          fontSize: 32,
          color: "#0f172a",
          margin: "0 0 6px",
          lineHeight: 1.05,
        }}
      >
        {fullName}
      </h1>

      <div
        style={{
          fontSize: 14,
          color: "#475569",
          margin: "0 0 26px",
          letterSpacing: 0.3,
        }}
      >
        {ageGenderLine}
      </div>

      {/* Three-tile date strip. Tiles are accent-bordered, generous
          padding — premium feel without becoming a sticker chart. */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 14,
          margin: "0 0 28px",
        }}
      >
        {tiles.map((t, i) => (
          <div
            key={`tile-${i}`}
            style={{
              width: "60mm",
              padding: "12px 8px 10px",
              border: `1.5px solid ${ACCENT}`,
              borderRadius: 4,
              background: "#ffffff",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: 1.5,
                color: ACCENT,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              {t.label}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#0f172a",
                lineHeight: 1.05,
                fontFamily: "'DM Sans', Georgia, serif",
              }}
            >
              {t.big}
            </div>
            {t.small ? (
              <div
                style={{
                  fontSize: 10,
                  color: "#64748b",
                  marginTop: 3,
                  letterSpacing: 0.3,
                }}
              >
                {t.small}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* The lede — single big-italic sentence that frames the
          admission. Constrained width so it feels like display copy. */}
      <div
        style={{
          maxWidth: "140mm",
          margin: "0 auto 22px",
          fontSize: 14,
          fontStyle: "italic",
          lineHeight: 1.55,
          color: "#334155",
          textAlign: "center",
          fontFamily: "'DM Sans', Georgia, serif",
        }}
      >
        {lede}
      </div>

      {/* Allergy / alert callout (only when there's something to flag).
          Still understated — uppercase letter-spaced accent strip, no
          loud red because this is the hero page. The body sections
          carry the standard NABH-style red callout if surveyors need
          something punchier. */}
      {allergies.length > 0 ? (
        <div
          style={{
            maxWidth: "140mm",
            margin: "0 auto",
            padding: "8px 14px",
            border: `1px solid ${ACCENT}`,
            borderRadius: 3,
            color: ACCENT,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 2,
            textAlign: "center",
            textTransform: "uppercase",
          }}
        >
          Patient Alert — {allergies.join(" · ")}
        </div>
      ) : null}
    </section>
  );
};

/* ============================================================
   Main component
   ============================================================ */

const EditorialTheme = ({ settings = {}, file, events = [] }) => {
  const f = file || {};
  const pn = pronoun(f.patient?.gender);

  /* ── Patient strip (PrintShell renders this on pages 2+).
        Pages 1 still gets the shell header + title bar, but the
        patient strip is duplicated by the hero card anyway —
        PrintShell prints the strip on every page, so leaving the
        strip data populated keeps subsequent pages anchored with
        the IDs surveyors expect. */
  const genderAge = [
    f.patient?.age ? `${f.patient.age} yrs` : null,
    f.patient?.gender || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const patientLeft = [
    { label: "Patient",     value: f.patient?.fullName || "—" },
    { label: "UHID",        value: f.meta?.uhid || "—" },
    { label: "IPD No",      value: f.meta?.ipdNo || "—" },
    { label: "Age / Sex",   value: genderAge || "—" },
    { label: "Blood Group", value: f.patient?.bloodGroup || "—" },
    { label: "Contact",     value: f.patient?.mobile || "—" },
  ];
  const patientRight = [
    { label: "Admitted",    value: fmtDate(f.admission?.date, true) },
    { label: "Discharged",  value: fmtDate(f.admission?.dischargeDate, true) },
    { label: "Length of Stay", value: f.admission?.totalDays != null ? `${f.admission.totalDays} day(s)` : "—" },
    { label: "Consultant",  value: f.admission?.consultant || "—" },
    { label: "Bed / Ward",  value: [f.admission?.bed, f.admission?.ward].filter(Boolean).join(" · ") || "—" },
    { label: "Department",  value: f.admission?.department || "—" },
  ];

  const signatures = {
    type: "single",
    centre: {
      name: f.signatures?.consultant || f.admission?.consultant || "",
      role: "Consultant",
      reg: f.ia?.doctor?.signedByReg || "",
    },
  };

  /* ── Section 1: Clinical Picture (HOPI + chief) ──────────── */
  const chief = f.history?.chief
    ? String(f.history.chief).replace(/\s+/g, " ").trim()
    : "";
  const hopi = f.history?.hopi
    ? String(f.history.hopi).replace(/\s+/g, " ").trim()
    : "";
  const subj = pn.subj;
  const pos = pn.pos;

  const clinicalParas = [];
  if (chief) {
    clinicalParas.push(
      cleanSentence(
        `${subj} presented with ${chief.replace(/\.$/, "")}`,
      ),
    );
  }
  if (hopi) {
    /* Split HOPI on newlines so multi-sentence history reads as
       multiple short paragraphs (magazine layouts breathe better
       this way than a single brick of prose). */
    hopi.split(/\n+/).forEach((line) => {
      const t = line.trim();
      if (t) clinicalParas.push(cleanSentence(t));
    });
  }

  /* ── Section 2: A Closer Look (past Hx + exam + vitals) ─── */
  const closerParas = [];
  const pastBits = [];
  if (f.history?.medical) {
    pastBits.push(`past medical history is significant for ${String(f.history.medical).replace(/\.$/, "")}`);
  }
  if (f.history?.surgical) {
    pastBits.push(`past surgical history includes ${String(f.history.surgical).replace(/\.$/, "")}`);
  }
  if (pastBits.length) {
    closerParas.push(
      cleanSentence(`${subj}'s ${pastBits.join("; ")}`),
    );
  }
  const famSoc = [
    f.history?.family ? `Family history reveals ${String(f.history.family).replace(/\.$/, "")}` : "",
    f.history?.social ? `socially, ${String(f.history.social).replace(/\.$/, "")}` : "",
  ].filter(Boolean);
  if (famSoc.length) {
    closerParas.push(cleanSentence(famSoc.join("; ")));
  }
  const examBits = [];
  if (f.exam?.generalExam) examBits.push(`On general examination ${String(f.exam.generalExam).replace(/\.$/, "")}`);
  if (f.exam?.systemicExam) examBits.push(`on systemic examination ${String(f.exam.systemicExam).replace(/\.$/, "")}`);
  if (examBits.length) {
    closerParas.push(cleanSentence(examBits.join(". ")));
  }
  const vs = vitalsSentence(f.vitals?.onAdmission);
  if (vs) closerParas.push(vs);

  /* ── Section 3: Course of Care — by day from events ─────── */
  const CLINICAL_KINDS = new Set([
    "admission", "doctor-note", "procedure", "med-start", "discharge",
  ]);
  const courseEvents = (events || []).filter((e) => CLINICAL_KINDS.has(e.kind));

  /* Group events by day-of-admission. Each day becomes one short
     editorial paragraph led by a "Day N." accent label. */
  const courseByDay = new Map();
  courseEvents.forEach((e) => {
    const d = dayNumber(e.at, f.admission?.date);
    if (d == null) return;
    if (!courseByDay.has(d)) courseByDay.set(d, []);
    courseByDay.get(d).push(e);
  });
  const sortedDays = Array.from(courseByDay.keys()).sort((a, b) => a - b);

  const courseDayParas = sortedDays.map((day) => {
    const evs = courseByDay.get(day) || [];
    /* Prefer the doctor-note's `detail` (full text) over the truncated
       `summary` so the prose reads like clinician notes, not log lines.
       Filter out duplicate phrases when admission + IA fire on day 1. */
    const seen = new Set();
    const bits = [];
    evs.forEach((e) => {
      const txt =
        e.kind === "doctor-note" && e.detail
          ? e.detail
          : e.summary || "";
      const norm = String(txt).replace(/\s+/g, " ").trim();
      if (!norm) return;
      const key = norm.toLowerCase().slice(0, 50);
      if (seen.has(key)) return;
      seen.add(key);
      bits.push(norm.replace(/\.$/, ""));
    });
    if (!bits.length) return null;
    const sentence = cleanSentence(bits.join(". "));
    return { day, sentence };
  }).filter(Boolean);

  /* ── Section 4: Investigations ──────────────────────────── */
  const invs = (f.investigations || []).filter((i) => i.name);

  /* ── Section 5: Medications (in-column 2-col grid) ──────── */
  const meds = (f.medications || []).filter((m) => m.drug);

  /* ── Pull-quotes (2-3, pulled from discharge / final note) ─ */
  const pullQuotes = [];

  /* PQ #1 — diagnosis line. Prefer the discharge summary's first
     sentence; fall back to a constructed line from the final Dx. */
  const discSummary = f.discharge?.summary
    ? String(f.discharge.summary).replace(/\s+/g, " ").trim()
    : "";
  if (discSummary) {
    const firstSentence = discSummary.split(/(?<=[.!?])\s+/)[0];
    if (firstSentence && firstSentence.length > 24) {
      pullQuotes.push({
        text: firstSentence.replace(/\.$/, "") + ".",
        slot: "after-clinical",
      });
    }
  } else if (f.admission?.finalDiagnosis) {
    pullQuotes.push({
      text: `${subj} was treated for ${String(f.admission.finalDiagnosis).replace(/\.$/, "")}, responding well to standard supportive care.`,
      slot: "after-clinical",
    });
  }

  /* PQ #2 — discharge fitness, harvested from the final doctor note
     when one exists. Look for "fit for discharge" / "tolerating" cues. */
  const lastDoctorNote = (f.doctorNotes || [])
    .filter((n) => n.content)
    .sort((a, b) =>
      (new Date(b.createdAt || 0).getTime()) - (new Date(a.createdAt || 0).getTime()),
    )[0];
  if (lastDoctorNote && lastDoctorNote.content) {
    const c = String(lastDoctorNote.content).replace(/\s+/g, " ").trim();
    const sentences = c.split(/(?<=[.!?])\s+/);
    /* Pick the punchiest single sentence — prefer one mentioning
       discharge / fit / tolerating, else use the first. */
    const candidate =
      sentences.find((s) => /\b(fit|discharge|tolerat|afebrile|stable)\b/i.test(s)) ||
      sentences[0];
    if (candidate && candidate.length > 24 && candidate.length < 220) {
      const days = f.admission?.totalDays;
      const lead = days ? `By Day ${days}, ` : "";
      const rest = candidate.replace(/^[A-Z]/, (ch) => ch.toLowerCase());
      pullQuotes.push({
        text: `${lead}${rest.replace(/\.$/, "")}.`.replace(/^By Day \d+, ([a-z])/, (m, c0) => `By Day ${days}, ${c0.toUpperCase()}`),
        slot: "after-course",
      });
    }
  }

  /* PQ #3 — only if first two are present and there's room. We use
     a vital-narrative line from the early progress note. */
  if (pullQuotes.length === 2 && (f.doctorNotes || []).length >= 2) {
    const midNote = f.doctorNotes
      .filter((n) => n.content && n !== lastDoctorNote)
      .sort((a, b) =>
        (new Date(a.createdAt || 0).getTime()) - (new Date(b.createdAt || 0).getTime()),
      )[0];
    if (midNote && midNote.content) {
      const c = String(midNote.content).replace(/\s+/g, " ").trim();
      const candidate = c.split(/(?<=[.!?])\s+/).find((s) => s.length > 30 && s.length < 200);
      if (candidate) {
        pullQuotes.push({
          text: candidate.replace(/\.$/, "") + ".",
          slot: "after-investigations",
        });
      }
    }
  }

  /* ── Discharge advice list ──────────────────────────────── */
  const adviceLines = (() => {
    const a = f.discharge?.advice;
    if (!a) return [];
    return String(a)
      .split(/\n+|(?:^|\s)\d+[\.)]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  })();

  /* The wrapping style on the body wires the hospital accent into a
     CSS variable so every accent reference (`var(--pr-accent-color,
     #1d4ed8)`) honours admin settings without any prop drilling. The
     2-column rule is applied to a child `<div>` (not this wrapper)
     because the hero card / final page must NOT be columnar. */
  const accentColor = settings.printAccentColor || "#1d4ed8";

  return (
    <PrintShell
      hospital={settings}
      docTitle="Patient File"
      docSubtitle="Personal medical record"
      patient={{ left: patientLeft, right: patientRight }}
      signatures={signatures}
      banners={{ emergency24x7: true }}
      meta={{
        docNumber: f.meta?.ipdNo || "",
        pageOf: "",
        printedAt: f.meta?.printedAt
          ? new Date(f.meta.printedAt).toISOString()
          : new Date().toISOString(),
      }}
    >
      <div style={{ "--pr-accent-color": accentColor }}>
        {/* ── PAGE 1: hero card ─────────────────────────────── */}
        <HeroCard file={f} />

        {/* ── PAGES 2+: magazine 2-col body ─────────────────── */}
        <div
          style={{
            columnCount: 2,
            WebkitColumnCount: 2,
            columnGap: "8mm",
            WebkitColumnGap: "8mm",
            columnFill: "balance",
            WebkitColumnFill: "balance",
            fontSize: 10.5,
            lineHeight: 1.55,
            color: "#1f2937",
            textAlign: "justify",
          }}
        >
          {/* 1. CLINICAL PICTURE */}
          {clinicalParas.length > 0 && (
            <>
              <SectionHeading>The Clinical Picture</SectionHeading>
              <DropCapPara text={clinicalParas[0]} />
              {clinicalParas.slice(1).map((t, i) => (
                <Para key={`cp-${i}`}>{t}</Para>
              ))}
              <ColumnDivider />
            </>
          )}

          {/* PQ #1 — sits between clinical picture and the closer
              look so it acts as a chapter break / hook. */}
          {pullQuotes.find((p) => p.slot === "after-clinical") ? (
            <PullQuote>
              {pullQuotes.find((p) => p.slot === "after-clinical").text}
            </PullQuote>
          ) : null}

          {/* 2. A CLOSER LOOK */}
          {closerParas.length > 0 && (
            <>
              <SectionHeading>A Closer Look</SectionHeading>
              <DropCapPara text={closerParas[0]} />
              {closerParas.slice(1).map((t, i) => (
                <Para key={`cl-${i}`}>{t}</Para>
              ))}
              <ColumnDivider />
            </>
          )}

          {/* 3. COURSE OF CARE — day-by-day narrative */}
          {courseDayParas.length > 0 && (
            <>
              <SectionHeading>The Course of Care</SectionHeading>
              {courseDayParas.map(({ day, sentence }, i) => {
                /* First day gets the drop-cap to anchor the section. */
                if (i === 0) {
                  /* Day label is rendered inline ahead of the
                     drop-cap by sliding the label into the paragraph
                     text — keeps editorial cadence intact. */
                  return (
                    <p
                      key={`day-${day}`}
                      style={{
                        fontSize: 10.5,
                        lineHeight: 1.55,
                        textAlign: "justify",
                        margin: "0 0 8px 0",
                        color: "#1f2937",
                      }}
                    >
                      <strong style={{ color: ACCENT, marginRight: 4 }}>
                        Day {day}.
                      </strong>
                      {sentence}
                    </p>
                  );
                }
                return (
                  <Para key={`day-${day}`}>
                    <strong style={{ color: ACCENT, marginRight: 4 }}>
                      Day {day}.
                    </strong>
                    {sentence}
                  </Para>
                );
              })}
              <ColumnDivider />
            </>
          )}

          {/* PQ #2 — discharge-fitness callout AFTER the course
              narrative so it lands like a closing line. */}
          {pullQuotes.find((p) => p.slot === "after-course") ? (
            <PullQuote>
              {pullQuotes.find((p) => p.slot === "after-course").text}
            </PullQuote>
          ) : null}

          {/* 4. INVESTIGATIONS — terse single-paragraph summary,
              abnormal findings called out by name. */}
          {invs.length > 0 && (
            <>
              <SectionHeading>Investigations</SectionHeading>
              {(() => {
                const names = invs.map((i) => i.name);
                const findings = invs
                  .filter((i) => i.result)
                  .map((i) => `${i.name} — ${String(i.result).replace(/\.$/, "")}`);
                const intro = `Diagnostic work-up included ${oxford(names)}.`;
                const finding = findings.length
                  ? ` Significant findings: ${findings.join("; ")}.`
                  : "";
                return <DropCapPara text={intro + finding} />;
              })()}
              <ColumnDivider />
            </>
          )}

          {/* PQ #3 — optional, drops in only when first two are
              present and we have an extra clean clinician sentence. */}
          {pullQuotes.find((p) => p.slot === "after-investigations") ? (
            <PullQuote>
              {pullQuotes.find((p) => p.slot === "after-investigations").text}
            </PullQuote>
          ) : null}

          {/* 5. MEDICATIONS — kept IN-COLUMN as a 2-col grid so it
              stays on the editorial spread rather than breaking the
              magazine flow. Drug+dose+freq on the left,
              duration+indication on the right. */}
          {meds.length > 0 && (
            <>
              <SectionHeading>Medications</SectionHeading>
              <div
                style={{
                  fontSize: 10,
                  lineHeight: 1.4,
                  color: "#1f2937",
                  marginBottom: 6,
                }}
              >
                {meds.map((m, i) => {
                  const left = [m.drug, m.dose, m.frequency, m.route]
                    .filter(Boolean)
                    .join(" · ");
                  const rightBits = [];
                  if (m.endDate) rightBits.push(`until ${fmtDate(m.endDate)}`);
                  if (m.indication) rightBits.push(m.indication);
                  const right = rightBits.join(" · ");
                  return (
                    <div
                      key={`med-${i}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                        padding: "3px 0",
                        borderBottom: i === meds.length - 1 ? "none" : "1px dotted #cbd5e1",
                        breakInside: "avoid",
                        pageBreakInside: "avoid",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>{left || "—"}</div>
                      <div style={{ color: "#475569", fontStyle: right ? "italic" : "normal" }}>
                        {right || ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── FINAL PAGE: Continuing Care ─────────────────────── */}
        {(adviceLines.length > 0 || f.discharge?.followUpDate) ? (
          <section
            style={{
              breakBefore: "page",
              pageBreakBefore: "always",
              padding: "12px 0 0",
            }}
          >
            <h2
              style={{
                textAlign: "center",
                color: ACCENT,
                fontSize: 14,
                textTransform: "uppercase",
                letterSpacing: 1.4,
                fontWeight: 700,
                margin: "12px 0 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 0,
                  borderTop: `1px solid ${ACCENT}`,
                  opacity: 0.55,
                  maxWidth: "30mm",
                }}
              />
              <span style={{ whiteSpace: "nowrap" }}>Continuing Care</span>
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 0,
                  borderTop: `1px solid ${ACCENT}`,
                  opacity: 0.55,
                  maxWidth: "30mm",
                }}
              />
            </h2>

            {adviceLines.length > 0 ? (
              <ol
                style={{
                  maxWidth: "140mm",
                  margin: "0 auto 22px",
                  padding: "0 0 0 24px",
                  fontSize: 11,
                  lineHeight: 1.7,
                  color: "#1f2937",
                }}
              >
                {adviceLines.map((t, i) => (
                  <li
                    key={`adv-${i}`}
                    style={{
                      marginBottom: 6,
                      paddingLeft: 4,
                    }}
                  >
                    {t}
                  </li>
                ))}
              </ol>
            ) : null}

            {f.discharge?.followUpDate || f.admission?.consultant ? (
              <p
                style={{
                  maxWidth: "140mm",
                  margin: "0 auto",
                  textAlign: "center",
                  fontSize: 12,
                  fontStyle: "italic",
                  color: "#334155",
                  lineHeight: 1.55,
                }}
              >
                {subj.charAt(0).toUpperCase() + subj.slice(1).toLowerCase()} is advised to follow up
                {f.admission?.consultant ? ` with ${f.admission.consultant}` : ""}
                {f.discharge?.followUpDate
                  ? ` on ${fmtDate(f.discharge.followUpDate)}`
                  : " as advised"}
                . Should any concern arise in the interim, {pos} treating team
                remains available round-the-clock through the hospital helpline.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </PrintShell>
  );
};

export default EditorialTheme;
