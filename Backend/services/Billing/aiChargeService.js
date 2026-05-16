// services/Billing/aiChargeService.js
// ═══════════════════════════════════════════════════════════════
// AI Charge Suggester — uses Claude API to identify missed charges
// based on patient diagnosis and current bill state.
//
// Surfaces:
//   suggestMissedCharges  → calls Claude, returns ranked suggestions
//   confirmAISuggestions  → adds confirmed suggestions to the bill
//
// Design notes:
//  • Model: claude-opus-4-7 (most capable for clinical reasoning)
//  • Adaptive thinking ON — Claude decides reasoning depth per case
//  • Prompt caching ON  — the service-catalogue prefix is stable per
//    `patientType`, so the bulk of the prompt cost is paid once per
//    patient-type per ~1h window and ~10× cheaper on every reuse
//  • Structured output via output_config.format — no fragile regex
//    JSON parsing
// ═══════════════════════════════════════════════════════════════

const Anthropic = require("@anthropic-ai/sdk");
const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
const PatientBill   = require("../../models/PatientBillModel/PatientBillModel");

const MODEL   = "claude-opus-4-7";
const EFFORT  = "high";              // low | medium | high | xhigh | max
const MAX_OUT = 3000;                // big enough for 8 suggestions × ~300 tokens each

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ─────────────────────────────────────────────────────────────
   System prompt — stable, cacheable
───────────────────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are an expert medical billing analyst for an Indian NABH-accredited hospital.

Your job: given a patient's diagnosis/reason-for-admission AND the current bill,
identify clinically-indicated services that are MISSING from the bill.

Reasoning principles:
1. Only suggest services that are clinically warranted by the diagnosis.
2. Prefer high-impact misses (investigations, monitoring, NABH-mandatory care)
   over low-value or speculative add-ons.
3. Skip services unrelated to this diagnosis even if they look billable.
4. For each suggestion provide a confidence score 0.0-1.0:
   - 0.9-1.0 = clearly indicated, would be malpractice to miss
   - 0.7-0.9 = standard-of-care for this condition
   - 0.5-0.7 = often indicated but case-dependent
   - below 0.5 = do not surface
5. Mark urgency:
   - "high"   = needed within 24h (sepsis workup, neuro obs, etc.)
   - "medium" = needed during current admission
   - "low"    = beneficial but optional

You will ALWAYS respond in valid JSON matching the schema provided.`;

/* ─────────────────────────────────────────────────────────────
   Structured-output schema (output_config.format)
───────────────────────────────────────────────────────────── */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          serviceId:   { type: "string", description: "Exact _id from the catalogue (24-char ObjectId)" },
          serviceName: { type: "string" },
          reason:      { type: "string", description: "1-2 sentence clinical justification" },
          confidence:  { type: "number", description: "0.5 to 1.0" },
          urgency:     { type: "string", enum: ["high", "medium", "low"] },
          category:    { type: "string", description: "serviceType from the catalogue line" },
        },
        required: ["serviceId", "serviceName", "reason", "confidence", "urgency", "category"],
        additionalProperties: false,
      },
    },
    summary:        { type: "string", description: "1-sentence overview of the analysis" },
    redFlags:       { type: "array",  description: "Critical missing services with confidence >= 0.9",
                      items: { type: "string" } },
  },
  required: ["suggestions", "summary", "redFlags"],
  additionalProperties: false,
};

/* ─────────────────────────────────────────────────────────────
   Build the cacheable catalogue prefix
   (one block per patient type; cached for ~1h after first use)
───────────────────────────────────────────────────────────── */
async function buildCatalogueBlock(patientType) {
  const services = await ServiceMaster.find({
    isActive: true,
    $or: [{ applicableTo: patientType }, { applicableTo: "ALL" }],
  })
    .select("_id serviceName serviceCode category serviceType defaultPrice aiTags chargeableBy")
    .sort({ _id: 1 })  // deterministic order — required for prefix caching
    .lean();

  const lines = services.map(
    (s) =>
      `[${s._id}] ${s.serviceName} | ${s.serviceType} | INR ${s.defaultPrice} | tags: ${(s.aiTags || []).join(",")}`
  );
  return { services, catalogueText: lines.join("\n") };
}

/* ─────────────────────────────────────────────────────────────
   suggestMissedCharges — main entry
───────────────────────────────────────────────────────────── */
async function suggestMissedCharges({
  billId,
  diagnosis,
  patientType = "IPD",
  additionalContext = [],
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!diagnosis) throw new Error("diagnosis is required");

  // 1. Current bill items
  const bill = await PatientBill.findById(billId).lean();
  if (!bill) throw new Error("Bill not found");
  const currentItems = bill.billItems || [];
  const currentIds   = new Set(currentItems.map((i) => i.serviceId?.toString()).filter(Boolean));
  const currentNames = currentItems.map((i) => i.serviceName).join(", ") || "None";

  // 2. Catalogue — same FULL text per patientType (cacheable prefix);
  //    "already-billed" filtering happens in the prompt body, not the prefix.
  const { services, catalogueText } = await buildCatalogueBlock(patientType);

  // 3. Volatile user content (changes per request)
  const userContent =
    `PATIENT TYPE: ${patientType}\n` +
    `DIAGNOSIS / REASON FOR ADMISSION: ${diagnosis}\n` +
    (additionalContext.length ? `ADDITIONAL CONTEXT: ${additionalContext.join("; ")}\n` : "") +
    `\nCURRENT BILL ITEMS (skip these - already charged):\n${currentNames}\n` +
    `\nIdentify up to 8 services from the catalogue that are clinically ` +
    `indicated for this diagnosis but not yet billed. Focus on ` +
    `investigations needed for monitoring, standard-of-care procedures, ` +
    `and NABH-mandatory items. Skip services unrelated to this diagnosis.`;

  // 4. Call Claude with:
  //    - adaptive thinking (Claude decides depth)
  //    - effort=high
  //    - cache_control on the catalogue (stable prefix)
  //    - structured output via output_config.format
  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: MAX_OUT,
    thinking:   { type: "adaptive" },
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: [
      // Stable system prompt — included in the cached prefix
      { type: "text", text: SYSTEM_PROMPT },
      // Catalogue is the large stable per-patient-type block — cache it.
      // Cache TTL = 1h so even occasional usage stays warm.
      {
        type: "text",
        text:
          `AVAILABLE SERVICE CATALOGUE (patient type: ${patientType}):\n` +
          catalogueText,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  // 5. Parse the structured output
  const textBlock = response.content.find((b) => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(textBlock?.text || "{}");
  } catch (e) {
    console.error("AI charge: JSON parse failed", e.message, textBlock?.text);
    parsed = { suggestions: [], summary: "AI response could not be parsed", redFlags: [] };
  }

  // 6. Defence in depth — drop any suggestion whose serviceId isn't in
  //    the catalogue (prevents hallucinated IDs leaking into the bill).
  const validIds = new Set(services.map((s) => s._id.toString()));
  parsed.suggestions = (parsed.suggestions || [])
    .filter((s) => validIds.has(s.serviceId) && !currentIds.has(s.serviceId))
    .filter((s) => typeof s.confidence === "number" && s.confidence >= 0.5)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  return {
    suggestions:         parsed.suggestions,
    summary:             parsed.summary || "",
    redFlags:            parsed.redFlags || [],
    diagnosis,
    patientType,
    currentItemCount:    currentItems.length,
    scannedServiceCount: services.length,
    model:               MODEL,
    usage: {
      input_tokens:                response.usage.input_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens || 0,
      cache_read_input_tokens:     response.usage.cache_read_input_tokens || 0,
      output_tokens:               response.usage.output_tokens,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
   confirmAISuggestions — write confirmed picks to the bill
───────────────────────────────────────────────────────────── */
async function confirmAISuggestions(billId, serviceIds, confirmedBy) {
  // billingService.js exports an INSTANCE (not a class) — use it directly.
  const billingService = require("./billingService");
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    return { added: 0, failed: 0, results: [] };
  }
  const results = [];
  for (const serviceId of serviceIds) {
    try {
      const bill = await billingService.addServiceToBill(
        billId,
        serviceId,
        1,
        new Date(),
        `AI-suggested charge confirmed by ${confirmedBy || "system"}`
      );

      // Tag the most recently appended item as AI-confirmed
      const item = bill.billItems[bill.billItems.length - 1];
      if (item) {
        item.aiSuggested   = true;
        item.addedBySource = "AI-Confirmed";
        item.addedBy       = confirmedBy || "system";
        item.addedByRole   = "AI-Confirmed";
        await bill.save();
      }
      results.push({ serviceId, status: "added" });
    } catch (e) {
      results.push({ serviceId, status: "error", message: e.message });
    }
  }
  return {
    added:  results.filter((r) => r.status === "added").length,
    failed: results.filter((r) => r.status === "error").length,
    results,
  };
}

module.exports = { suggestMissedCharges, confirmAISuggestions };
