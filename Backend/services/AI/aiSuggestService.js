// services/AI/aiSuggestService.js
// ═══════════════════════════════════════════════════════════════
// Claude-powered charge suggester
// Reads the open bill + patient context → returns missed charges
// ═══════════════════════════════════════════════════════════════

const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");

class AISuggestService {
  // ── Main entry point ─────────────────────────────────────────
  async suggestCharges(billId) {
    // 1. Load bill with all context
    const bill = await PatientBill.findById(billId)
      .populate("patient", "fullName title gender dateOfBirth UHID tpa")
      .populate("tpa", "tpaName")
      .populate("admission", "admissionNumber admissionDateTime bedNumber roomCategory wardName diagnosis status")
      .populate("billItems.serviceId", "serviceCode serviceName category");

    if (!bill) throw new Error("Bill not found");

    // 2. Load available services for this visit type
    const domainMap = {
      OPD: "OPD",
      IPD: "IPD",
      EMERGENCY: "EMERGENCY",
      DAYCARE: "DAYCARE",
    };
    const domain = domainMap[bill.visitType] || "COMMON";

    const availableServices = await ServiceMaster.find({
      isActive: true,
      $or: [
        { applicableTo: { $in: [bill.visitType, "ALL"] } },
        { domain },
      ],
    })
      .select("serviceCode serviceName category billingType defaultPrice unitLabel isAutoCharged")
      .sort({ category: 1, displayOrder: 1 })
      .limit(120);

    // 3. Build context for Claude
    const context = this._buildContext(bill, availableServices);

    // 4. Call Claude API
    const suggestions = await this._callClaude(context);

    // 5. Enrich suggestions with full service objects
    return this._enrichSuggestions(suggestions, availableServices);
  }

  // ── Build structured context object ─────────────────────────
  _buildContext(bill, availableServices) {
    const patient = bill.patient;
    const admission = bill.admission;

    // Calculate days admitted
    let admissionDays = null;
    if (admission?.admissionDateTime) {
      const ms = Date.now() - new Date(admission.admissionDateTime).getTime();
      admissionDays = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
    }

    // Current bill items — codes already on bill
    const currentItems = (bill.billItems || []).map((item) => ({
      serviceCode: item.serviceId?.serviceCode || item.serviceCode,
      serviceName: item.serviceId?.serviceName || item.serviceName,
      category: item.serviceId?.category || item.category,
      quantity: item.quantity,
      amount: item.grossAmount,
    }));

    // Available services (not already on bill)
    const currentCodes = new Set(currentItems.map((i) => i.serviceCode));
    const candidateServices = availableServices
      .filter((s) => !currentCodes.has(s.serviceCode))
      .map((s) => ({
        serviceCode: s.serviceCode,
        serviceName: s.serviceName,
        category: s.category,
        billingType: s.billingType,
        defaultPrice: s.defaultPrice,
        unitLabel: s.unitLabel || "",
        isAutoCharged: s.isAutoCharged,
      }));

    return {
      patient: {
        name: patient
          ? `${patient.title || ""} ${patient.fullName || ""}`.trim()
          : "Unknown",
        gender: patient?.gender || "Unknown",
        age: patient?.dateOfBirth
          ? Math.floor(
              (Date.now() - new Date(patient.dateOfBirth).getTime()) /
                (1000 * 60 * 60 * 24 * 365.25)
            )
          : null,
        uhid: bill.UHID,
        paymentType: bill.paymentType,
        tpaName: bill.tpaName || null,
      },
      visit: {
        visitType: bill.visitType,
        billStatus: bill.billStatus,
        admissionDays,
        bedNumber: admission?.bedNumber || null,
        roomCategory: admission?.roomCategory || null,
        ward: admission?.wardName || null,
        diagnosis: admission?.diagnosis || null,
        admissionStatus: admission?.status || null,
      },
      currentItems,
      candidateServices,
    };
  }

  // ── Call Claude API via native fetch ─────────────────────────
  async _callClaude(context) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured in .env");

    const prompt = this._buildPrompt(context);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    return this._parseJSON(text);
  }

  // ── Prompt builder ────────────────────────────────────────────
  _buildPrompt(ctx) {
    const { patient, visit, currentItems, candidateServices } = ctx;

    const patientLine = [
      patient.name,
      patient.gender,
      patient.age ? `${patient.age} yrs` : null,
      `UHID: ${patient.uhid}`,
      patient.tpaName ? `TPA: ${patient.tpaName}` : `Payment: ${patient.paymentType}`,
    ]
      .filter(Boolean)
      .join(" | ");

    const visitLine = [
      `Visit: ${visit.visitType}`,
      visit.admissionDays ? `${visit.admissionDays} day(s) admitted` : null,
      visit.roomCategory ? `Room: ${visit.roomCategory}` : null,
      visit.ward ? `Ward: ${visit.ward}` : null,
      visit.diagnosis ? `Diagnosis: ${visit.diagnosis}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const currentItemsText =
      currentItems.length === 0
        ? "  (none yet)"
        : currentItems
            .map(
              (i) =>
                `  - [${i.serviceCode}] ${i.serviceName} × ${i.quantity} = ₹${i.amount}`
            )
            .join("\n");

    const candidateText = candidateServices
      .slice(0, 80) // keep prompt manageable
      .map(
        (s) =>
          `  ${s.serviceCode} | ${s.serviceName} | ${s.category} | ${s.billingType} | ₹${s.defaultPrice}${s.unitLabel ? " " + s.unitLabel : ""}`
      )
      .join("\n");

    return `You are a hospital billing assistant for SphereHealth HIS. Analyze the patient's current bill and suggest MISSED charges that are typically applicable for this type of visit.

## Patient
${patientLine}

## Visit Details
${visitLine}

## Current Bill Items (ALREADY CHARGED — do NOT suggest these)
${currentItemsText}

## Available Services to Choose From
Format: CODE | Name | Category | BillingType | Price
${candidateText}

## Rules
1. Only suggest services from the Available Services list above
2. Do NOT suggest anything already in Current Bill Items
3. Focus on commonly missed charges for ${visit.visitType} visits
4. For IPD with ${visit.admissionDays || 1} day(s): suggest per-day charges with correct quantity
5. Prioritize HIGH confidence suggestions (routinely billed for this visit type)
6. Suggest 3–8 items maximum
7. Return ONLY valid JSON, no markdown, no explanation outside the JSON

## Required JSON format
[
  {
    "serviceCode": "IPD-NUR-001",
    "reason": "Short reason why this charge applies",
    "confidence": "HIGH",
    "suggestedQuantity": ${visit.admissionDays || 1}
  }
]

confidence must be exactly: "HIGH", "MEDIUM", or "LOW"`;
  }

  // ── Parse Claude's JSON response ──────────────────────────────
  _parseJSON(text) {
    // Strip any markdown code fences if present
    const cleaned = text
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();

    // Extract JSON array
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];

    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // ── Enrich suggestions with full service data ─────────────────
  _enrichSuggestions(rawSuggestions, availableServices) {
    const serviceMap = new Map(availableServices.map((s) => [s.serviceCode, s]));

    return rawSuggestions
      .map((s) => {
        const svc = serviceMap.get(s.serviceCode);
        if (!svc) return null;

        const qty = Math.max(1, parseInt(s.suggestedQuantity) || 1);
        return {
          serviceCode: svc.serviceCode,
          serviceId: svc._id,
          serviceName: svc.serviceName,
          category: svc.category,
          billingType: svc.billingType,
          unitPrice: svc.defaultPrice,
          suggestedQuantity: qty,
          estimatedTotal: svc.defaultPrice * qty,
          reason: s.reason || "",
          confidence: ["HIGH", "MEDIUM", "LOW"].includes(s.confidence)
            ? s.confidence
            : "MEDIUM",
        };
      })
      .filter(Boolean);
  }
}

module.exports = new AISuggestService();
