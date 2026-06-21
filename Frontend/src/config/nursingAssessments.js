// config/nursingAssessments.js
// R7hr-231 — the catalogue of nursing assessments a DOCTOR can assign to a
// patient (with a per-day minimum). `id` MUST match the nursing-notes module id
// (NursingNotes.jsx MODULES) so the nurse's "open this assessment" action opens
// the right form, and so today's done-count (by noteType) lines up. Shared by
// the doctor's Nursing Plan editor and the nurse's required-assessments strip.
export const NURSING_ASSESSMENTS = [
  { id: "vitals",    label: "Vital Signs",            icon: "❤",  nabh: "NS.4" },
  { id: "pain",      label: "Pain Assessment",        icon: "😣", nabh: "AAC.4" },
  { id: "neuro",     label: "Neuro / GCS",            icon: "🧠", nabh: "AAC.4" },
  { id: "mews",      label: "MEWS Score",             icon: "⚠",  nabh: "COP.17" },
  { id: "fall",      label: "Fall Risk (Morse)",      icon: "🚶", nabh: "AAC.4" },
  { id: "dvt",       label: "DVT (Caprini)",          icon: "🦵", nabh: "MOM.7" },
  { id: "skin",      label: "Skin / Pressure",        icon: "🔲", nabh: "AAC.4" },
  { id: "intake",    label: "Intake / Output",        icon: "💧", nabh: "COP.16" },
  { id: "wound",     label: "Wound / Dressing",       icon: "🩹", nabh: "COP.15" },
  { id: "iv",        label: "IV Infusion",            icon: "💉", nabh: "MOM.4" },
  { id: "blood",     label: "Blood Transfusion",      icon: "🩸", nabh: "COP.16" },
  { id: "daily",     label: "Daily Assessment",       icon: "📋", nabh: "NS.4" },
  { id: "nutrition", label: "Nutritional Assessment", icon: "🥗", nabh: "COP.16" },
  { id: "education", label: "Patient Education",       icon: "📚", nabh: "PRE.5" },
];

export const ASSESSMENT_BY_ID = NURSING_ASSESSMENTS.reduce((m, a) => { m[a.id] = a; return m; }, {});
