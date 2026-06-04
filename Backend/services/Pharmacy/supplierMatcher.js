/**
 * supplierMatcher.js  (R7hr-16 — C3)
 *
 * Match an extracted invoice supplier (name + GSTIN) against the local
 * PharmacySupplier collection. Used by the parse-invoice controller
 * (C7) before showing the GRN preview UI so the supplier dropdown can
 * auto-select.
 *
 * Strategy:
 *   1. GSTIN exact match (case-insensitive, whitespace-stripped). If
 *      GSTIN matches a supplier exactly, confidence = 1.0 — GSTIN is
 *      a unique statutory identifier, no fuzzy fallback needed.
 *   2. Otherwise, name fuzzy match — token Jaccard + bigram overlap,
 *      same scoring shape as drugMatcher.js (consistency wins; same
 *      mental model for the operator reading the confidence pill).
 *      Floor: 0.3 — below that the suggestion is more confusing than
 *      helpful.
 *
 * Cache: 5-minute in-memory snapshot of all suppliers (~100 rows at
 * a typical hospital). Cleared lazily on TTL expiry.
 *
 * Error policy: never throws. DB error → null supplier, empty
 * alternatives. C7 catches anything anyway, but defence in depth keeps
 * the parse-invoice flow from going 500 because of a hiccup in a
 * "best-effort" suggestion layer.
 */

let _supplierModel = null;
function _getModel() {
  // R7hr-16: lazy require so the model doesn't get pulled during boot
  // for processes that never touch pharmacy (cron-only runners, etc.).
  if (!_supplierModel) {
    try { _supplierModel = require("../../models/Pharmacy/SupplierModel"); }
    catch (_) { _supplierModel = null; }
  }
  return _supplierModel;
}

let _supplierCache = null;
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function _loadSuppliers(opts = {}) {
  if (opts.suppliers && Array.isArray(opts.suppliers)) return opts.suppliers;
  const now = Date.now();
  if (_supplierCache && (now - _cacheLoadedAt) < CACHE_TTL_MS) return _supplierCache;

  const Sup = _getModel();
  if (!Sup) return [];
  try {
    _supplierCache = await Sup.find({}, { name: 1, gstin: 1, address: 1, city: 1, state: 1 }).lean();
    _cacheLoadedAt = now;
  } catch (_) {
    // Don't poison the cache on a transient error — return empty so
    // the caller can still complete the parse without a suggestion.
    return [];
  }
  return _supplierCache;
}

function _normaliseGstin(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, "");
}

function _normaliseName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _tokens(s) {
  return _normaliseName(s).split(" ").filter(t => t.length > 1);
}

function _jaccard(a, b) {
  const setA = new Set(a), setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const uni = setA.size + setB.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function _bigrams(s) {
  const out = new Set();
  const n = _normaliseName(s).replace(/\s/g, "");
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
}

function _bigramOverlap(a, b) {
  const A = _bigrams(a), B = _bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function _scoreName(extracted, candidate) {
  if (!extracted || !candidate) return 0;
  const tA = _tokens(extracted), tB = _tokens(candidate);
  if (!tA.length || !tB.length) return 0;
  // Weighted blend: half token-set similarity, half bigram overlap.
  // Token-set handles word reordering ("Apollo Pharma Distributors"
  // vs "Apollo Distributors Pharma"); bigram catches abbreviation
  // drift ("Apollo Pharmaceuticals" → "Apollo Pharma").
  return 0.5 * _jaccard(tA, tB) + 0.5 * _bigramOverlap(extracted, candidate);
}

/**
 * Resolve a supplier from extracted invoice data.
 *
 * @param {{name?: string, gstin?: string}} extracted
 * @param {{suppliers?: Array, minConfidence?: number}} [opts]
 * @returns {Promise<{supplier: Object|null, confidence: number, alternatives: Array<{supplier: Object, score: number}>}>}
 */
async function findSupplier(extracted, opts = {}) {
  const empty = { supplier: null, confidence: 0, alternatives: [] };
  if (!extracted || typeof extracted !== "object") return empty;

  const minConfidence = typeof opts.minConfidence === "number"
    ? opts.minConfidence
    : 0.0;

  let suppliers = [];
  try { suppliers = await _loadSuppliers(opts); }
  catch (_) { return empty; }
  if (!suppliers.length) return empty;

  // R7hr-16: Tier 1 — GSTIN exact match wins outright. GSTIN is
  // statutory + unique-per-state; an exact match is by definition the
  // right supplier. Confidence pinned at 1.0.
  const gstNorm = _normaliseGstin(extracted.gstin);
  if (gstNorm && /^[0-9A-Z]{15}$/.test(gstNorm)) {
    const hit = suppliers.find(s => _normaliseGstin(s.gstin) === gstNorm);
    if (hit) {
      return { supplier: hit, confidence: 1.0, alternatives: [] };
    }
  }

  // R7hr-16: Tier 2 — name fuzzy. Score every candidate and rank.
  const scored = suppliers.map(s => ({
    supplier: s,
    score: _scoreName(extracted.name, s.name),
  })).sort((a, b) => b.score - a.score);

  const winner = scored[0];
  if (!winner || winner.score <= 0.3 || winner.score < minConfidence) {
    return empty;
  }

  const alternatives = scored
    .slice(1, 4)
    .filter(s => s.score > 0)
    .map(s => ({ supplier: s.supplier, score: s.score }));

  return {
    supplier: winner.supplier,
    confidence: winner.score,
    alternatives,
  };
}

function _resetCache() {
  _supplierCache = null;
  _cacheLoadedAt = 0;
}

module.exports = {
  findSupplier,
  // Test/debug exports — not part of the public surface, but reachable
  // for unit tests that want deterministic state.
  _resetCache,
  _scoreName,
};
