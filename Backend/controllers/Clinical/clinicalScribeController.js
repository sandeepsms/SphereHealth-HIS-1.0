/**
 * clinicalScribeController.js — AI Clinical Documentation Assistant (ambient scribe)
 *
 * Thin HTTP layer over services/Clinical/clinicalScribeService. Takes a consult
 * transcript + surface and returns a STRUCTURED clinical-note draft for the
 * doctor to review, edit, and apply. It never writes a clinical record — the
 * doctor saves/signs via the normal assessment / doctor-note / discharge flow.
 */
"use strict";

const scribe = require("../../services/Clinical/clinicalScribeService");

// GET /api/clinical-scribe/status — lets the frontend hide the feature when no
// ANTHROPIC_API_KEY is configured on this deployment.
exports.status = async (req, res) => {
  return res.json({ success: true, data: { enabled: scribe.isConfigured(), surfaces: scribe.SURFACES } });
};

// POST /api/clinical-scribe/structure  { transcript, surface, context? }
exports.structure = async (req, res) => {
  try {
    const transcript = req.body && req.body.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) {
      return res.status(422).json({ success: false, code: "TRANSCRIPT_REQUIRED", message: "A consultation transcript is required." });
    }
    const surface = req.body && req.body.surface;
    const context = (req.body && req.body.context && typeof req.body.context === "object") ? req.body.context : undefined;

    const note = await scribe.structureTranscript(transcript, { surface, context });
    return res.json({ success: true, data: note });
  } catch (err) {
    // Feature not configured on this deployment → 503 (frontend shows "AI scribe
    // not enabled"); too-short transcript → 422; anything else from the model
    // path → 502. Never leak the prompt or the API key.
    if (err && err.code === "LLM_NOT_CONFIGURED") {
      return res.status(503).json({ success: false, code: "SCRIBE_NOT_CONFIGURED", message: "AI scribe is not enabled on this deployment (no model key configured)." });
    }
    if (err && err.code === "TRANSCRIPT_TOO_SHORT") {
      return res.status(422).json({ success: false, code: "TRANSCRIPT_TOO_SHORT", message: "The transcript is too short to structure — record or dictate more of the consultation." });
    }
    // eslint-disable-next-line no-console
    console.error("[clinical-scribe] structure failed:", err && err.message);
    return res.status(502).json({ success: false, code: "SCRIBE_FAILED", message: "The AI scribe could not structure this transcript. Try again, or document manually." });
  }
};
