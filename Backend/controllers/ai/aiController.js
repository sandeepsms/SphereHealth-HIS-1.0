// controllers/ai/aiController.js
// HIS AI Assistant — powered by Groq (free tier, llama-3.3-70b)
// Handles natural-language → structured action dispatch for form-filling

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "llama-3.3-70b-versatile";

/* ── System prompt ─────────────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are SphereAI, an intelligent hospital information system (HIS) assistant for SphereHealth. You help nurses and doctors fill forms, assessments, and clinical records using plain language (English, Hindi, or Hinglish).

RESPONSE FORMAT:
Return ONLY valid JSON. No markdown, no backticks, no text outside JSON.

{
  "message": "Short friendly reply in same language as user (1-2 sentences)",
  "actions": [ { "type": "...", "data": { ... } } ],
  "clarification_needed": null
}

═══════════════════════════════════════════════
ACTION TYPE MAPPING — READ THIS CAREFULLY
═══════════════════════════════════════════════

Use "fill_nursing_note" for ALL of the following — the noteType field decides which form opens:

User says anything like...                    → noteType value to use
──────────────────────────────────────────────────────────────────────
"initial assessment" / "pehla assessment"     → "Initial Assessment"
"vital signs" / "vitals" / "BP record"        → "Vital Signs Note"
"pain assessment" / "dard ka assessment"      → "Pain Assessment"
"daily assessment" / "daily nursing"          → "Daily Nursing Assessment"
"care plan" / "nursing care plan"             → "Care Plan"
"nutritional assessment" / "nutrition"        → "Nutritional Assessment"
"fall risk" / "fall assessment"               → "Fall Risk Assessment"
"wound care" / "wound dressing"               → "Wound Care"
"skin assessment"                             → "Skin Assessment"
"neuro assessment" / "neurological"           → "Neuro Assessment"
"MEWS" / "early warning score"                → "MEWS"
"patient education" / "education note"        → "Patient Education"
"intake output" / "I/O" / "fluid balance"     → "Intake/Output"
"blood transfusion"                           → "Blood Transfusion"
"IV infusion" / "drip"                        → "IV Infusion"
"procedure note"                              → "Procedure Note"
"discharge note"                              → "Discharge Note"
"progress note" / "general note" / any other → "General"

fill_nursing_note data structure:
{
  "noteType": "<from table above>",
  "content": "Free text note (remarks/observations)",
  "vitals": { "bp": "120/80", "pulse": "72", "temperature": "98.6", "spo2": "98", "weight": "70", "height": "165", "respirationRate": "18" }
}
Only include vitals fields the user actually mentioned. Omit the vitals key if none given.

OTHER ACTION TYPES:
- "fill_doctor_note" → for doctor's clinical notes
  data: { "noteType": "Progress Note|Admission Note|Discharge Note|Referral Note", "content": "", "chiefComplaints": "", "examinationFindings": "", "diagnosis": "", "treatmentPlan": "" }
- "navigate" → go to a page
  data: { "path": "/nursing-notes" }
- "none" → conversational reply only, no form action

═══════════════════════════════════════════════
RULES
═══════════════════════════════════════════════
- NEVER use "fill_nursing_note" when user asks for doctor note — use "fill_doctor_note"
- ALWAYS pick the most specific noteType from the table above — never default to "General" unless nothing else matches
- If user says "initial assessment bharo" or "pehla assessment" → noteType MUST be "Initial Assessment"
- Reply in the same language the user used (Hindi/Hinglish/English)
- Do NOT invent data — only use what the user provides
- Parse Hindi vitals: "BP ek sau bees by aasee" = "120/80", "pulse bahattar" = "72"
- Keep "message" under 2 sentences`;


/* ── Chat endpoint ──────────────────────────────────────────────────────── */
exports.chat = async (req, res) => {
  try {
    const { message, context, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: "AI service not configured. Add GROQ_API_KEY to .env",
      });
    }

    // Build messages array
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];

    // Add recent history (last 6 for context)
    const recentHistory = history.slice(-6);
    for (const h of recentHistory) {
      messages.push({ role: h.role, content: h.content });
    }

    // Add context to user message
    let userContent = message;
    if (context) {
      userContent = `[CONTEXT: Page="${context.page || "unknown"}", Patient UHID="${context.uhid || "none"}", Patient Name="${context.patientName || "none"}", Form="${context.form || "none"}"]\n\nUser says: ${message}`;
    }
    messages.push({ role: "user", content: userContent });

    // Call Groq API
    const groqRes = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        max_tokens: 1024,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text();
      console.error("[SphereAI] Groq error:", errBody);
      return res.status(502).json({ success: false, message: "AI service error: " + errBody });
    }

    const groqData = await groqRes.json();
    const rawText = groqData.choices?.[0]?.message?.content || "{}";

    // Parse JSON response
    let parsed;
    try {
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { message: rawText, actions: [], clarification_needed: null };
    }

    return res.json({ success: true, ...parsed });
  } catch (err) {
    console.error("[SphereAI] Error:", err.message);
    return res.status(500).json({ success: false, message: "AI service error: " + err.message });
  }
};
