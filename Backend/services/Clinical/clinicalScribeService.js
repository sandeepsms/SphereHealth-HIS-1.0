/**
 * clinicalScribeService.js — AI Clinical Documentation Assistant (ambient scribe)
 *
 * Turns a raw doctor–patient consultation TRANSCRIPT (produced by the
 * browser's live speech-to-text, or dictated/pasted) into a STRUCTURED
 * clinical note the doctor can review + apply into the OPD assessment / IPD
 * progress note / discharge summary form. The doctor always reviews and signs;
 * this service only DRAFTS.
 *
 * Same guaranteed-structured-output pattern as services/Pharmacy/
 * llmInvoiceExtractor.js: Anthropic Claude with a FORCED tool-use call, so the
 * model must return a typed JSON object matching the tool schema — no
 * text-parsing, no JSON.parse-and-pray.
 *
 * SAFETY (this is a clinical tool):
 *   • The model is instructed to structure ONLY what the transcript supports and
 *     to leave fields empty when something wasn't discussed — it must NOT invent
 *     diagnoses, drug doses, or vitals. Anything uncertain goes into `notes`.
 *   • Output is a DRAFT for human review; the caller never auto-saves/auto-signs.
 *
 * Env: ANTHROPIC_API_KEY  (missing => clean LLM_NOT_CONFIGURED, mapped to 503).
 *      SCRIBE_MODEL       (optional model override; defaults to a proven Sonnet).
 */
"use strict";

// SDK shape juggling — mirrors llmInvoiceExtractor so both survive an SDK bump.
const AnthropicLib = require("@anthropic-ai/sdk");
const Anthropic = AnthropicLib.default || AnthropicLib.Anthropic || AnthropicLib;

// Lazy module-scope singleton — the SDK only initialises on the first real
// structuring call, NOT at server boot, so the backend stays bootable (and the
// scribe stays feature-flagged OFF) on any deployment without the key set.
let _client = null;
function client() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      const e = new Error("LLM_NOT_CONFIGURED");
      e.code = "LLM_NOT_CONFIGURED";
      throw e;
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** Is the scribe usable on this deployment? (drives the FE feature flag) */
function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SURFACES = ["opd", "ipd", "discharge"];
const DEFAULT_MODEL = process.env.SCRIBE_MODEL || "claude-sonnet-4-5-20250929";
const MAX_INPUT_CHARS = 40000;   // ~a very long consult; guards against abuse
const MIN_INPUT_CHARS = 15;      // below this there's nothing to structure

const _clamp01 = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
};
const _str = (v) => String(v == null ? "" : v).trim();
const _arr = (v, cap) => (Array.isArray(v) ? v.slice(0, cap) : []);

// The tool the model is FORCED to call. tool_choice:{type:'tool',name:...}
// guarantees a `tool_use` content block whose `.input` matches this schema.
// One superset schema covers all three surfaces; the system prompt tells the
// model which fields matter for the requested surface.
const structureNoteTool = {
  name: "structure_clinical_note",
  description:
    "Convert a raw doctor-patient consultation transcript into a structured clinical note. " +
    "Only fill fields the transcript actually supports; leave the rest empty. Never invent.",
  input_schema: {
    type: "object",
    properties: {
      chiefComplaint: { type: "string", description: "Presenting complaint in the patient's words, concise." },
      hopi: {
        type: "object",
        description: "History of presenting illness — only fields mentioned.",
        properties: {
          onset: { type: "string" },
          duration: { type: "string" },
          progression: { type: "string" },
          character: { type: "string" },
          associatedSymptoms: { type: "array", items: { type: "string" } },
          aggravatingFactors: { type: "string" },
          relievingFactors: { type: "string" },
          treatmentTried: { type: "string" },
          narrative: { type: "string", description: "Free-text HOPI paragraph." },
        },
      },
      pastHistory: { type: "string", description: "Relevant past medical / surgical / drug / allergy history mentioned." },
      examination: {
        type: "object",
        properties: {
          general: { type: "string", description: "General examination findings stated." },
          systemic: { type: "string", description: "Systemic examination findings stated." },
          vitals: {
            type: "object",
            properties: {
              bp: { type: "string" }, pulse: { type: "string" }, temp: { type: "string" },
              spo2: { type: "string" }, respRate: { type: "string" }, weight: { type: "string" }, height: { type: "string" },
            },
          },
        },
      },
      diagnoses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            type: { type: "string", enum: ["provisional", "working", "final", "differential"] },
            icd10Hint: { type: "string", description: "Best-guess ICD-10 code IF confident, else empty." },
          },
          required: ["text"],
        },
      },
      medications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            genericName: { type: "string" },
            dose: { type: "string" },
            frequency: { type: "string", description: "e.g. OD, BD, TDS, HS, SOS" },
            duration: { type: "string" },
            route: { type: "string", description: "Oral / IV / IM / etc." },
            instructions: { type: "string" },
          },
          required: ["name"],
        },
      },
      investigations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            urgency: { type: "string", enum: ["Routine", "STAT"] },
            instructions: { type: "string" },
          },
          required: ["name"],
        },
      },
      advice: { type: "string", description: "Advice / plan given to the patient." },
      followUp: { type: "string", description: "Follow-up instruction (e.g. review in 5 days)." },
      courseInHospital: { type: "string", description: "IPD/discharge only: narrative of the hospital course." },
      conditionOnDischarge: { type: "string", description: "Discharge only: e.g. Stable / Improved." },
      soap: {
        type: "object",
        description: "Free-text SOAP mirror of the note.",
        properties: {
          subjective: { type: "string" },
          objective: { type: "string" },
          assessment: { type: "string" },
          plan: { type: "string" },
        },
      },
      redFlags: {
        type: "array",
        items: { type: "string" },
        description: "Safety concerns heard in the transcript (drug allergy mentioned, danger sign, red-flag symptom) — for the doctor's attention.",
      },
      notes: { type: "string", description: "Your caveats: anything ambiguous, low-confidence, or that the doctor must verify." },
      confidence: { type: "number", description: "Overall confidence 0 (mostly guessed) to 1 (transcript was explicit)." },
    },
    required: ["chiefComplaint"],
  },
};

function _systemPrompt(surface) {
  const base =
    "You are a careful clinical documentation assistant (medical scribe) for an Indian hospital. " +
    "You are given the raw, possibly messy speech-to-text transcript of a doctor-patient consultation " +
    "(English and/or Hindi, mixed). Convert it into a STRUCTURED clinical note by calling the tool.\n\n" +
    "HARD RULES:\n" +
    "1. Use ONLY information present in the transcript. If something was not discussed, leave that field empty — do NOT infer, guess, or invent findings, diagnoses, drug doses, or vitals.\n" +
    "2. Normalise Hindi / mixed-language speech and casual phrasing into standard English medical terminology, but never change the clinical meaning.\n" +
    "3. Preserve exact drug names, doses, and frequencies as spoken. If a dose was not stated, leave dose empty rather than assuming a standard dose.\n" +
    "4. Put anything ambiguous, mis-heard, or that the doctor must verify into `notes`. Surface any allergy mention or danger sign in `redFlags`.\n" +
    "5. This is a DRAFT for the doctor to review, edit, and sign — accuracy and honesty about uncertainty matter more than completeness.";
  const perSurface = {
    opd:
      "\n\nThis is an OUTPATIENT (OPD) consultation. Emphasise chiefComplaint, hopi, examination, diagnoses (provisional/working), medications, investigations, advice and followUp. courseInHospital/conditionOnDischarge do not apply — leave empty.",
    ipd:
      "\n\nThis is an INPATIENT (IPD) ward-round / progress note. Emphasise the SOAP note (soap.subjective/objective/assessment/plan), any change in diagnoses, today's medications/orders, and the plan. Keep it a progress note, not a fresh full history.",
    discharge:
      "\n\nThis is a DISCHARGE summary dictation. Emphasise final diagnoses, courseInHospital (the narrative of the hospital stay), discharge medications, conditionOnDischarge, advice and followUp instructions.",
  };
  return base + (perSurface[surface] || perSurface.opd);
}

/**
 * Structure a consultation transcript into a clinical note.
 * @param {string} transcript  raw STT / dictated text
 * @param {object} [opts]
 * @param {"opd"|"ipd"|"discharge"} [opts.surface]  which form this note targets
 * @param {object} [opts.context]  optional { age, sex, uhid } — used only to phrase, never persisted here
 * @param {string} [opts.model]    model override
 * @returns {Promise<object>}  structured note (see structureNoteTool schema, coerced)
 */
async function structureTranscript(transcript, opts = {}) {
  const surface = SURFACES.includes(opts.surface) ? opts.surface : "opd";
  const text = String(transcript || "").slice(0, MAX_INPUT_CHARS);
  if (text.trim().length < MIN_INPUT_CHARS) {
    const e = new Error("TRANSCRIPT_TOO_SHORT");
    e.code = "TRANSCRIPT_TOO_SHORT";
    throw e;
  }
  const model = opts.model || DEFAULT_MODEL;

  // Optional demographic context helps disambiguate (never persisted here).
  const ctx = opts.context || {};
  const ctxLine = [ctx.age && `Age: ${_str(ctx.age)}`, ctx.sex && `Sex: ${_str(ctx.sex)}`]
    .filter(Boolean).join(", ");
  const userContent = (ctxLine ? `[Patient context — ${ctxLine}]\n\n` : "") + text;

  let response;
  try {
    response = await client().messages.create({
      model,
      max_tokens: 4096,
      system: _systemPrompt(surface),
      tools: [structureNoteTool],
      tool_choice: { type: "tool", name: "structure_clinical_note" },
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    if (err && err.code === "LLM_NOT_CONFIGURED") throw err;
    const wrapped = new Error("SCRIBE_STRUCTURE_FAILED: " + (err && err.message ? err.message : "unknown"));
    wrapped.code = "SCRIBE_STRUCTURE_FAILED";
    throw wrapped;
  }

  const blocks = Array.isArray(response && response.content) ? response.content : [];
  const toolBlock = blocks.find((b) => b && b.type === "tool_use" && b.name === "structure_clinical_note");
  if (!toolBlock || !toolBlock.input || typeof toolBlock.input !== "object") {
    const wrapped = new Error("SCRIBE_STRUCTURE_FAILED: no tool_use block in response");
    wrapped.code = "SCRIBE_STRUCTURE_FAILED";
    throw wrapped;
  }

  const raw = toolBlock.input;
  const h = raw.hopi || {};
  const ex = raw.examination || {};
  const vit = ex.vitals || {};
  const soap = raw.soap || {};

  // Coerce defensively — the schema enforced types at the SDK layer, but be
  // paranoid (the model can still emit a number as a string on edge cases).
  const note = {
    surface,
    chiefComplaint: _str(raw.chiefComplaint),
    hopi: {
      onset: _str(h.onset),
      duration: _str(h.duration),
      progression: _str(h.progression),
      character: _str(h.character),
      associatedSymptoms: _arr(h.associatedSymptoms, 30).map(_str).filter(Boolean),
      aggravatingFactors: _str(h.aggravatingFactors),
      relievingFactors: _str(h.relievingFactors),
      treatmentTried: _str(h.treatmentTried),
      narrative: _str(h.narrative),
    },
    pastHistory: _str(raw.pastHistory),
    examination: {
      general: _str(ex.general),
      systemic: _str(ex.systemic),
      vitals: {
        bp: _str(vit.bp), pulse: _str(vit.pulse), temp: _str(vit.temp),
        spo2: _str(vit.spo2), respRate: _str(vit.respRate),
        weight: _str(vit.weight), height: _str(vit.height),
      },
    },
    diagnoses: _arr(raw.diagnoses, 20).map((d) => ({
      text: _str(d && d.text),
      type: ["provisional", "working", "final", "differential"].includes(d && d.type) ? d.type : "provisional",
      icd10Hint: _str(d && d.icd10Hint),
    })).filter((d) => d.text),
    medications: _arr(raw.medications, 40).map((m) => ({
      name: _str(m && m.name),
      genericName: _str(m && m.genericName),
      dose: _str(m && m.dose),
      frequency: _str(m && m.frequency),
      duration: _str(m && m.duration),
      route: _str(m && m.route),
      instructions: _str(m && m.instructions),
    })).filter((m) => m.name),
    investigations: _arr(raw.investigations, 40).map((i) => ({
      name: _str(i && i.name),
      urgency: (i && i.urgency) === "STAT" ? "STAT" : "Routine",
      instructions: _str(i && i.instructions),
    })).filter((i) => i.name),
    advice: _str(raw.advice),
    followUp: _str(raw.followUp),
    courseInHospital: _str(raw.courseInHospital),
    conditionOnDischarge: _str(raw.conditionOnDischarge),
    soap: {
      subjective: _str(soap.subjective),
      objective: _str(soap.objective),
      assessment: _str(soap.assessment),
      plan: _str(soap.plan),
    },
    redFlags: _arr(raw.redFlags, 20).map(_str).filter(Boolean),
    notes: _str(raw.notes),
    confidence: _clamp01(raw.confidence),
    aiAssisted: true,   // provenance marker the review UI can surface
    model,
  };

  // PII-safe log — surface + sizes + counts only, NEVER the transcript or the
  // parsed clinical content.
  console.info(
    `[clinical-scribe] surface=${surface} chars=${text.length} dx=${note.diagnoses.length} rx=${note.medications.length} ix=${note.investigations.length} conf=${note.confidence}`,
  );

  return note;
}

module.exports = {
  structureTranscript,
  isConfigured,
  SURFACES,
  _private: { structureNoteTool, DEFAULT_MODEL, MAX_INPUT_CHARS, MIN_INPUT_CHARS },
};
