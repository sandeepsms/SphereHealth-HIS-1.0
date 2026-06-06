/**
 * llmInvoiceExtractor.js  (R7hr-16 / C6)
 *
 * Calls Anthropic Claude (Sonnet 4.5 by default) with a forced tool-use
 * call to coerce the model into a typed JSON shape — this is the
 * documented pattern for guaranteed structured output. No regex-on-text,
 * no JSON.parse-the-stream-and-pray.
 *
 * The route (C7) is responsible for fileHash-based dedup BEFORE calling
 * this — we do no caching here. We do no streaming. We do no prompt-cache
 * cache-controls (invoice prompts are unique per file, hit-rate ~= 0).
 *
 * Env: ANTHROPIC_API_KEY  (missing => clean LLM_NOT_CONFIGURED error,
 *                          mapped by the route to HTTP 503).
 */

// R7hr-16: SDK shape juggling — 0.39 exports default; defensive fallback
//          covers older/newer pinned variants without crashing at require.
const AnthropicLib = require("@anthropic-ai/sdk");
const Anthropic =
  AnthropicLib.default || AnthropicLib.Anthropic || AnthropicLib;

// R7hr-16: lazy module-scope singleton — SDK only initialises on first
//          actual extraction call, NOT at server boot. This keeps the
//          backend bootable on dev machines without the key set.
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

// R7hr-16: GST slab snap — Indian GST is one of {0,5,12,18,28}. The
//          model may emit 17.99 or 18.0; snap to the nearest valid slab
//          so downstream batch creation never sees a junk percentage.
//          Duplicates the 5-line helper from C4 (einvoiceJsonParser) on
//          purpose — keep them independent so reordering builders won't
//          break this one.
const _GST_SLABS = [0, 5, 12, 18, 28];
function _snapGstSlab(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  let best = _GST_SLABS[0];
  let bestDiff = Math.abs(x - best);
  for (let i = 1; i < _GST_SLABS.length; i++) {
    const d = Math.abs(x - _GST_SLABS[i]);
    if (d < bestDiff) {
      bestDiff = d;
      best = _GST_SLABS[i];
    }
  }
  return best;
}

// R7hr-16: confidence clamp helper — model is told to return 0..1 but
//          could emit 1.2 or -0.1 if it ignored the instruction.
function _clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// R7hr-16: ISO-or-null date coercion. Empty string / "N/A" / garbage
//          all collapse to null so callers can `if (d) ...` cleanly.
function _toDateOrNull(s) {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function _toNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

// R7hr-16: the tool schema the model is FORCED to call. By using
//          tool_choice:{type:'tool',name:...} we guarantee Anthropic
//          returns a content block of type 'tool_use' with a parsed
//          `.input` object matching this JSON schema — no text-parsing.
const extractInvoiceTool = {
  name: "extract_supplier_invoice",
  description:
    "Extract supplier, invoice meta, and drug line items from raw pharmacy invoice text.",
  input_schema: {
    type: "object",
    properties: {
      supplier: {
        type: "object",
        properties: {
          name: { type: "string" },
          gstin: { type: "string" },
          address: { type: "string" },
        },
        required: ["name"],
      },
      invoiceNo: { type: "string" },
      invoiceDate: { type: "string", description: "ISO YYYY-MM-DD" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            extractedName: { type: "string" },
            hsn: { type: "string" },
            batch: { type: "string" },
            expiry: { type: "string", description: "ISO YYYY-MM-DD or empty" },
            qty: { type: "number" },
            mrp: { type: "number" },
            purchaseRate: { type: "number" },
            discount: { type: "number" },
            gstPct: { type: "number" },
            total: { type: "number" },
            rawLineText: { type: "string" },
          },
          required: ["extractedName", "qty"],
        },
      },
      totals: {
        type: "object",
        properties: {
          taxable: { type: "number" },
          gst: { type: "number" },
          gross: { type: "number" },
        },
      },
      confidence: {
        type: "object",
        properties: {
          supplier: { type: "number" },
          invoiceNo: { type: "number" },
          invoiceDate: { type: "number" },
          lines: { type: "number" },
        },
      },
    },
    required: ["supplier", "lines"],
  },
};

// R7hr-16: system prompt — narrow, Indian-pharmacy-specific. Avoids any
//          "be creative" wording so the model sticks to verbatim extract.
const SYSTEM_PROMPT =
  "You extract structured fields from a pharmacy supplier invoice (India). " +
  "Indian GST slabs are 0, 5, 12, 18, 28. " +
  "Indian dates often appear DD/MM/YYYY — return ISO YYYY-MM-DD. " +
  "Trade name OR generic name is acceptable for extractedName — whichever appears in the printed invoice. " +
  "Per-field confidence is your own honest estimate from 0 (guessed) to 1 (visually unambiguous on the invoice).";

const MAX_INPUT_CHARS = 60000; // R7hr-16: guard against 200-page weird uploads
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929"; // R7hr-16: future toggle target = haiku

/**
 * Extract supplier-invoice structure from raw OCR / pdf-extracted text.
 *
 * @param {string} text     raw invoice text (will be truncated at 60k chars)
 * @param {object} [opts]
 * @param {string} [opts.fileHash]  forwarded into log line for traceability
 * @param {string} [opts.model]     override model (default sonnet-4.5)
 * @returns {Promise<object>}       see top-of-file shape
 */
async function extractInvoiceFromText(text, opts = {}) {
  const safeText = String(text || "").slice(0, MAX_INPUT_CHARS); // R7hr-16: bound input
  const hashTag = String(opts.fileHash || "").slice(0, 8) || "no-hash";
  const model = opts.model || DEFAULT_MODEL;

  let response;
  try {
    // R7hr-16: client() throws LLM_NOT_CONFIGURED if env missing — let it
    //          bubble; the route maps it to 503.
    response = await client().messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [extractInvoiceTool],
      // R7hr-16: forced tool use — the magic that makes structured output
      //          a contract, not a hope.
      tool_choice: { type: "tool", name: "extract_supplier_invoice" },
      messages: [{ role: "user", content: safeText }],
    });
  } catch (err) {
    // R7hr-16: do NOT leak the api key or full prompt back to the caller.
    if (err && err.code === "LLM_NOT_CONFIGURED") throw err;
    const wrapped = new Error("LLM_EXTRACT_FAILED: " + (err && err.message ? err.message : "unknown"));
    wrapped.code = "LLM_EXTRACT_FAILED";
    throw wrapped;
  }

  // R7hr-16: find the tool_use block. With tool_choice forced, the first
  //          (often only) content block IS the tool call — but iterate to
  //          be defensive against the model sneaking in a text preface.
  const blocks = Array.isArray(response && response.content) ? response.content : [];
  const toolBlock = blocks.find((b) => b && b.type === "tool_use" && b.name === "extract_supplier_invoice");
  if (!toolBlock || !toolBlock.input || typeof toolBlock.input !== "object") {
    const wrapped = new Error("LLM_EXTRACT_FAILED: no tool_use block in response");
    wrapped.code = "LLM_EXTRACT_FAILED";
    throw wrapped;
  }

  const raw = toolBlock.input;

  // R7hr-16: post-process — coerce types, snap GST, clamp confidence.
  //          The schema ENFORCED types at the SDK level, but the model
  //          can still emit "5" as a string for a number-typed field on
  //          edge cases; toNum is paranoid by design.
  const supplier = {
    name: String((raw.supplier && raw.supplier.name) || "").trim(),
    gstin: String((raw.supplier && raw.supplier.gstin) || "").trim(),
    address: String((raw.supplier && raw.supplier.address) || "").trim(),
  };

  const linesIn = Array.isArray(raw.lines) ? raw.lines : [];
  const lines = linesIn.map((ln) => ({
    extractedName: String((ln && ln.extractedName) || "").trim(),
    hsn: String((ln && ln.hsn) || "").trim(),
    batch: String((ln && ln.batch) || "").trim(),
    expiry: _toDateOrNull(ln && ln.expiry),
    qty: _toNum(ln && ln.qty),
    mrp: _toNum(ln && ln.mrp),
    purchaseRate: _toNum(ln && ln.purchaseRate),
    discount: _toNum(ln && ln.discount),
    gstPct: _snapGstSlab(ln && ln.gstPct),
    total: _toNum(ln && ln.total),
    rawLineText: String((ln && ln.rawLineText) || ""),
  }));

  const totals = {
    taxable: _toNum(raw.totals && raw.totals.taxable),
    gst: _toNum(raw.totals && raw.totals.gst),
    gross: _toNum(raw.totals && raw.totals.gross),
  };

  const confidence = {
    supplier: _clamp01(raw.confidence && raw.confidence.supplier),
    invoiceNo: _clamp01(raw.confidence && raw.confidence.invoiceNo),
    invoiceDate: _clamp01(raw.confidence && raw.confidence.invoiceDate),
    lines: _clamp01(raw.confidence && raw.confidence.lines),
  };

  const result = {
    supplier,
    invoiceNo: String(raw.invoiceNo || "").trim(),
    invoiceDate: _toDateOrNull(raw.invoiceDate),
    lines,
    totals,
    confidence,
  };

  // R7hr-16: PII-safe log — hash + bytes + line count only, NEVER the
  //          full text and NEVER the parsed supplier/patient fields.
  console.info(
    `[LLM-Invoice] hash=${hashTag} bytes=${safeText.length} ok lines=${lines.length}`
  );

  return result;
}

module.exports = {
  extractInvoiceFromText,
  // R7hr-16: private hooks exposed for unit-test reach-in only.
  _private: {
    _snapGstSlab,
    _clamp01,
    _toDateOrNull,
    extractInvoiceTool,
    DEFAULT_MODEL,
    MAX_INPUT_CHARS,
  },
};
