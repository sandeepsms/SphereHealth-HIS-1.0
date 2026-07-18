# AI Clinical Documentation Assistant (Ambient Scribe)

Turns a spoken doctor–patient consultation into a **structured clinical-note
draft** the doctor reviews, edits, and applies into the note form — then signs
as usual. It evolves the existing global voice-dictation widget from
"type-into-a-field" into an AI scribe.

> **Human-in-the-loop, always.** The scribe only DRAFTS. It never auto-saves and
> never auto-signs — the doctor reviews every field and saves/signs through the
> normal flow.

## Where it appears

A **🩺 AI Scribe** button on three surfaces (shown only when enabled — see below):

| Surface | Page | Fills |
|---|---|---|
| OPD assessment | `Frontend/src/pages/doctor/OPDAssessmentPage.jsx` | chief complaint · HOPI · exam · 3-tier diagnosis + ICD-10 · medications · investigations · advice |
| IPD progress note (daily) | `Frontend/src/pages/doctor/DoctorNotesPage.jsx` | SOAP · vitals · diagnosis · investigations · order rows |
| Discharge summary | `Frontend/src/pages/clinical/DischargeSummaryPage.jsx` | final diagnosis · course in hospital · discharge meds · condition · follow-up |

**Apply is non-destructive:** it fills *empty* fields and *appends* new
medications/investigations (deduped by name). It never overwrites text the
doctor already typed.

## Flow

`Consent → Capture → Review → Apply`

1. **Consent** — an explicit patient-consent checkbox + a PHI notice.
2. **Capture** — a live "Record consult" mic (browser Web Speech, EN/HI, reuses
   the `medicalDictionary` drug/abbreviation corrections) accumulating an
   editable transcript. Where Web Speech is unavailable, the doctor can dictate
   with the global mic or type/paste the transcript.
3. **Review** — the transcript is sent to Claude, which returns a typed note via
   a **forced tool_use** call (same guaranteed-structured-output pattern as the
   pharmacy invoice extractor). The draft is shown fully **editable** with a
   confidence badge and a **⚠️ red-flags** banner (allergy mentions / danger
   signs the model heard). The model is instructed to structure **only** what the
   transcript supports and to never invent diagnoses, doses, or vitals.
4. **Apply** — writes the reviewed draft into the current form.

## Architecture

**Backend**
- `services/Clinical/clinicalScribeService.js` — Anthropic Claude, forced
  tool_use → one superset `structure_clinical_note` schema (per-surface prompt).
  Lazy client init; PII-safe logging (surface + sizes + counts only, never the
  transcript or clinical content).
- `controllers/Clinical/clinicalScribeController.js` + `routes/Clinical/clinicalScribeRoutes.js`
  — `GET /api/clinical-scribe/status`, `POST /api/clinical-scribe/structure`.
- Permission `clinical.scribe` = `[Admin, Doctor]` (mirrored FE + BE).

**Frontend**
- `Components/scribe/AmbientScribe.jsx` — the reusable button + modal.
- `Components/scribe/scribeApply.js` — pure mappers (structured note → per-surface
  candidate field bags).

## Enable it (deploy-time)

Disabled by default — like ABDM, a stock deployment is unaffected and the button
is hidden (`GET /clinical-scribe/status` reports `enabled:false`, and
`POST /structure` returns `503`). To turn it on, set on the backend:

```bash
ANTHROPIC_API_KEY=sk-ant-...           # required — enables the scribe
SCRIBE_MODEL=claude-sonnet-4-5-20250929  # optional model override
```

Once the key is set, the 🩺 AI Scribe button appears for doctors and the
structuring endpoint is live.

## Privacy / PHI posture

The current capture uses the **browser Web Speech API**, which streams the
consultation audio to the browser vendor's cloud STT. That is a bigger PHI/DPDP
exposure than field dictation, so the scribe is gated behind an explicit
patient-consent step and an on-screen notice. **Production hardening (not yet
done): wire a self-hosted STT** so patient audio never leaves the deployment; the
AI structuring layer is unchanged by that swap (it works on any transcript).

## Verified

- Backend boots clean; `/status` reports `enabled:false` with no key; `/structure`
  → `503` (no key) / `422` (empty transcript); FE `vite build` green; **E2E 136/136**
  (fully additive). The live LLM structuring path requires `ANTHROPIC_API_KEY` and
  has not been exercised on the dev box (no key) — enable it in a keyed
  environment to validate end-to-end.
