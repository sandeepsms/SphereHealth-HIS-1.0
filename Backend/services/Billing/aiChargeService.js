// services/billing/aiChargeService.js
// ═══════════════════════════════════════════════════════════════
// AI Charge Suggester — uses Claude API to identify missed charges
// based on patient diagnosis and current bill state.
//
// Two main functions:
//   suggestMissedCharges  → calls Claude, returns ranked suggestions
//   confirmAISuggestions  → adds confirmed suggestions to the bill
// ═══════════════════════════════════════════════════════════════

const Anthropic = require("@anthropic-ai/sdk");
const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
const PatientBill = require("../../models/PatientBillModel/PatientBillModel");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Suggest missed charges based on diagnosis + current bill
 * @param {Object} params
 * @param {string} params.billId
 * @param {string} params.diagnosis  - patient's diagnosis / reason for admission
 * @param {string} params.patientType - OPD | IPD | DAYCARE | EMERGENCY
 * @param {string[]} [params.additionalContext] - extra clinical notes
 */
async function suggestMissedCharges({
  billId,
  diagnosis,
  patientType,
  additionalContext = [],
}) {
  // 1. Load current bill items
  const bill = await PatientBill.findById(billId).lean();
  if (!bill) throw new Error("Bill not found");

  // 2. Load active services for this patient type
  const services = await ServiceMaster.find({
    isActive: true,
    $or: [{ applicableTo: patientType }, { applicableTo: "ALL" }],
  })
    .select(
      "_id serviceName serviceCode category serviceType defaultPrice aiTags chargeableBy",
    )
    .lean();

  // 3. Build prompt context
  const currentItems = bill.billItems || [];
  const currentNames =
    currentItems.map((i) => i.serviceName).join(", ") || "None";
  const currentIds = new Set(currentItems.map((i) => i.serviceId?.toString()));

  const catalogue = services
    .filter((s) => !currentIds.has(s._id.toString()))
    .map(
      (s) =>
        `[${s._id}] ${s.serviceName} | ${s.serviceType} | ₹${s.defaultPrice} | tags: ${(s.aiTags || []).join(",")}`,
    )
    .join("\n");

  const systemPrompt = `You are an expert medical billing assistant for a hospital in India.
Your role is to analyze patient diagnosis and current bill to identify clinically relevant billable services that are missing.
Be precise — only suggest services that are genuinely indicated by the diagnosis.
Always respond with ONLY valid JSON, no markdown, no explanation outside JSON.`;

  const userPrompt = `PATIENT TYPE: ${patientType}
DIAGNOSIS / REASON FOR ADMISSION: ${diagnosis}
${additionalContext.length ? `ADDITIONAL CONTEXT: ${additionalContext.join("; ")}` : ""}

CURRENT BILL ITEMS (already charged):
${currentNames}

AVAILABLE SERVICES NOT YET BILLED:
${catalogue || "All services already billed."}

Identify up to 8 services from the catalogue that are clinically indicated for this diagnosis but not yet billed.
Consider: investigations needed for monitoring, standard nursing procedures for this condition, necessary consumables.
Skip: services clearly not related to this diagnosis.

Respond with ONLY this JSON:
{
  "suggestions": [
    {
      "serviceId": "<exact _id from catalogue>",
      "serviceName": "<exact name>",
      "reason": "<1-2 sentence clinical justification>",
      "confidence": <0.1 to 1.0>,
      "urgency": "high|medium|low",
      "category": "<serviceType>"
    }
  ],
  "summary": "<1 sentence overview of what was identified>"
}`;

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  let raw = response.content[0]?.text || "{}";
  // Strip any accidental markdown fences
  raw = raw.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { suggestions: [], summary: "Could not parse AI response" };
  }

  // Verify serviceIds exist in the catalogue
  const validIds = new Set(services.map((s) => s._id.toString()));
  parsed.suggestions = (parsed.suggestions || []).filter((s) =>
    validIds.has(s.serviceId),
  );

  return {
    suggestions: parsed.suggestions,
    summary: parsed.summary || "",
    diagnosis,
    patientType,
    currentItemCount: currentItems.length,
    scannedServiceCount: services.length,
    model: "claude-opus-4-5",
  };
}

/**
 * Confirm AI-suggested charges and add them to the bill
 * @param {string} billId
 * @param {string[]} serviceIds - which suggestions to confirm
 * @param {string} confirmedBy - name of who confirmed
 */
async function confirmAISuggestions(billId, serviceIds, confirmedBy) {
  // Use the uppercase Billing service (the one the controller uses)
  const BillingService = require("../Billing/billingService");

  const results = [];
  for (const serviceId of serviceIds) {
    try {
      const bill = await BillingService.addServiceToBill(
        billId,
        serviceId,
        1,
        new Date(),
        `AI-suggested charge confirmed by ${confirmedBy}`,
      );

      // Mark the last item as AI-suggested and update source tracking
      const item = bill.billItems[bill.billItems.length - 1];
      if (item) {
        item.aiSuggested = true;
        item.addedBySource = "AI-Confirmed";
        item.addedBy = confirmedBy;
        item.addedByRole = "AI-Confirmed";
      }
      await bill.save();
      results.push({ serviceId, status: "added" });
    } catch (e) {
      results.push({ serviceId, status: "error", message: e.message });
    }
  }
  return results;
}

module.exports = { suggestMissedCharges, confirmAISuggestions };
