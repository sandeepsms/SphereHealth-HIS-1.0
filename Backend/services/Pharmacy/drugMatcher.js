/**
 * drugMatcher.js   (R7hr-16)
 *
 * Pure service module — fuzzy match an extracted invoice-line drug name
 * against the in-house DrugMaster (PharmacyDrug) collection. Used by the
 * Claude-powered invoice parser (POST /grn/parse-invoice, C7) to suggest
 * drugId for each line before the pharmacist hits "Save row" in the GRN UI.
 *
 * Why hand-rolled and not a 3rd-party fuzzy lib:
 *   - Invoice OCR yields "TAB AMOXIL 500", "AMOX-CLAV 625 CAP", "PARA 500"
 *     etc. — a noisy, abbreviation-heavy domain. A weighted bag-of-tokens
 *     score (Jaccard + bigram overlap + first-token exact-match) beats a
 *     pure trigram score because the noise is concentrated in stop tokens
 *     (TAB / CAP / mg / ml) that we can strip cheaply.
 *   - 5–10k drug rows max → in-memory scan of a cached snapshot is < 5 ms
 *     per call. No need for a search-engine dependency.
 *   - Zero new npm deps — `fuse.js` / `string-similarity` etc are not
 *     installed in this repo (see planner deferred list).
 *
 * Caching:
 *   Invoice batches come in bursts (10–30 lines back-to-back from C7).
 *   We hold a module-level Drug snapshot for 5 minutes so 30 lines == 1
 *   Mongo round-trip, not 30. Caller (C7) can also pass `opts.drugs` to
 *   share its own pre-loaded snapshot across all lines explicitly.
 *
 * Error policy:
 *   Never throws. A DB error in the lazy-load path returns a null winner
 *   so a transient glitch can't 500 the upload endpoint upstream.
 */

// R7hr-16: Drug model required lazily inside the lazy-load function so a
// require-time mongoose import error can't crash the parent process at
// boot. Module load stays pure.
let _Drug = null;
function _getModel() {
  if (_Drug) return _Drug;
  try {
    _Drug = require("../../models/Pharmacy/DrugModel");
  } catch (e) {
    _Drug = null;
  }
  return _Drug;
}

// R7hr-16: module-level cache. _drugCache holds plain-object snapshots
// (toObject()) — caller never mutates them, so sharing is safe. TTL is
// 5 min: long enough that a 30-line invoice burst hits cache for lines
// 2…30, short enough that a freshly-added drug appears in matches before
// the pharmacist gives up and types it manually.
let _drugCache = null;
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

// R7hr-16: stop tokens — purely cosmetic noise on invoice lines. Strip
// before scoring so "TAB AMOXIL 500" and "AMOXIL 500 MG TABLET" both reduce
// to the same bag {amoxil, 500}. Keep numerics — they're the strength
// signal and tiebreaker (see scoring step 4).
const STOP_TOKENS = new Set([
  "tab", "tablet", "tablets", "tabs",
  "cap", "capsule", "capsules", "caps",
  "inj", "injection", "injectable",
  "syrup", "syp",
  "susp", "suspension",
  "drop", "drops",
  "oint", "ointment",
  "cream",
  "ml", "mg", "mcg", "gm", "g", "gel",
  "amp", "ampoule", "vial",
  "iv", "im", "sc", "po",
]);

// R7hr-16: form-prefix tokens that should be stripped from the head of
// the extracted name only (so "TAB AMOXIL" matches "AMOXIL" candidates
// correctly). Different from STOP_TOKENS which strips anywhere. Some
// overlap is intentional — STOP_TOKENS handles trailing "TABLET" too.
const FORM_PREFIXES = new Set([
  "tab", "tablet", "tablets",
  "cap", "capsule", "capsules",
  "inj", "injection",
  "syrup", "syp",
  "susp", "suspension",
  "drop", "drops",
  "oint", "ointment",
  "cream", "gel",
]);

// ── helpers ──────────────────────────────────────────────────────────

// R7hr-16: _normalize — lowercase, strip punctuation, collapse whitespace.
// Hyphens become spaces so "AMOX-CLAV" → "amox clav" (two tokens we can
// match piece-wise). Slashes too ("5MG/5ML" → "5mg 5ml") then mg/ml drop.
function _normalize(s) {
  if (s == null) return "";
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// R7hr-16: _tokens — normalize → split → drop STOP_TOKENS → drop empties.
// Returns an array (not a Set) so callers can do bigram windowing.
function _tokens(s) {
  const norm = _normalize(s);
  if (!norm) return [];
  return norm.split(" ").filter((t) => t.length > 0 && !STOP_TOKENS.has(t));
}

// R7hr-16: _stripFormPrefix — only peel the FIRST token if it's a form word.
// "TAB AMOXIL 500" → "amoxil 500". Leaves "AMOXIL 500" untouched.
function _stripFormPrefix(s) {
  const norm = _normalize(s);
  if (!norm) return "";
  const parts = norm.split(" ");
  if (parts.length > 1 && FORM_PREFIXES.has(parts[0])) {
    return parts.slice(1).join(" ");
  }
  return norm;
}

// R7hr-16: _jaccard — |A∩B| / |A∪B| on token sets. Returns 0 when both
// are empty (rather than NaN) so an unscoreable line just sinks to the
// bottom instead of throwing.
function _jaccard(a, b) {
  if (!a.length && !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// R7hr-16: _bigramOverlap — sliding 2-char window on the joined token
// string. Catches partial-spelling matches that Jaccard misses
// ("AMOXIL" vs "AMOXICILLIN" share "am","mo","ox","xi" bigrams even
// though they're zero-overlap as whole tokens). Weighted at 0.2 of total
// score — tiebreaker, not primary signal.
function _bigrams(s) {
  if (s.length < 2) return [];
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
  return out;
}
function _bigramOverlap(a, b) {
  const ga = _bigrams(a);
  const gb = _bigrams(b);
  if (!ga.length || !gb.length) return 0;
  const setB = new Set(gb);
  let hit = 0;
  for (const g of ga) if (setB.has(g)) hit++;
  // Symmetric — divide by the longer side so length asymmetry doesn't
  // unfairly punish a short query against a long candidate name.
  return hit / Math.max(ga.length, gb.length);
}

// R7hr-16: _lev — bounded Levenshtein with early-exit at `max`. Used only
// for first-token spell-tolerance ("AMOXYL" vs "AMOXIL" — 1 edit). We do
// NOT run Lev across the full string (O(n*m) on 30 lines x 5k drugs is
// too much). Bounded version returns max+1 when distance would exceed,
// avoiding the full matrix fill for clearly-different strings.
function _lev(a, b, max = 4) {
  if (a === b) return 0;
  if (!a.length) return b.length > max ? max + 1 : b.length;
  if (!b.length) return a.length > max ? max + 1 : a.length;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost     // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    // Early exit — if even the minimum cell in this row exceeds max,
    // no further row can improve it.
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// R7hr-16: _numericPrefix — pull the leading numeric run from a strength
// string. "500 mg" → "500"; "5 mg/5 mL" → "5"; "" → "". Used for the
// strength-tiebreaker bonus.
function _numericPrefix(s) {
  if (!s) return "";
  const m = String(s).match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? m[1] : "";
}

// R7hr-16: _loadDrugs — lazy snapshot loader. Honors caller-provided
// opts.drugs first (zero-DB path used by C7), then the 5-min module
// cache, then falls back to Drug.find. A DB error returns [] so the
// caller upstream (parse-invoice route) just sees a confidence:0 row
// and lets the pharmacist pick manually — never a 500.
async function _loadDrugs(opts) {
  if (Array.isArray(opts && opts.drugs)) return opts.drugs;

  const now = Date.now();
  if (_drugCache && (now - _cacheLoadedAt) < CACHE_TTL_MS) {
    return _drugCache;
  }

  const Drug = _getModel();
  if (!Drug) return [];

  try {
    const docs = await Drug.find(
      { isActive: true },
      { name: 1, genericName: 1, brandName: 1, strength: 1, form: 1, manufacturer: 1 }
    ).lean();
    _drugCache = docs || [];
    _cacheLoadedAt = now;
    return _drugCache;
  } catch (e) {
    // R7hr-16: swallow — we'd rather degrade to "no suggestions" than
    // break the whole parse endpoint on a transient mongo glitch.
    return [];
  }
}

// R7hr-16: _scoreCandidate — combines the four signals on one candidate.
// Weights chosen so a perfect token match alone (Jaccard=1) already
// clears the 0.3 default threshold; everything else is tiebreaker.
function _scoreCandidate(extTokens, extFirst, extStripped, cand, opts) {
  // Build candidate token bag from name + genericName + brandName.
  const candText = [cand.name, cand.genericName, cand.brandName]
    .filter(Boolean).join(" ");
  const candTokens = _tokens(candText);
  if (!candTokens.length) return { score: 0, drug: cand };

  // 1. Jaccard on tokens — primary signal (60%).
  const jac = _jaccard(extTokens, candTokens);

  // 2. Bigram overlap on the joined strings — partial spelling (20%).
  const bg = _bigramOverlap(extStripped, candTokens.join(" "));

  // 3. First-token exact match bonus (20%).
  const candFirst = candTokens[0] || "";
  const firstExact = extFirst && candFirst && extFirst === candFirst ? 1 : 0;

  let score = jac * 0.6 + bg * 0.2 + firstExact * 0.2;

  // 4. Levenshtein fallback on first token (+0.1) — catches "AMOXYL" vs
  //    "AMOXIL". Gated on first-letter match to avoid promoting unrelated
  //    drugs that happen to be 2 edits away (e.g. "AZITHRO" vs "AMITHRO").
  if (extFirst && candFirst &&
      extFirst !== candFirst &&
      extFirst[0] === candFirst[0]) {
    const d = _lev(extFirst, candFirst, 2);
    if (d <= 2) score += 0.1;
  }

  // 5. Strength tiebreaker (+0.05) — numeric prefix match on strength.
  if (opts && opts.strength) {
    const wantNum = _numericPrefix(opts.strength);
    const candNum = _numericPrefix(cand.strength || "");
    if (wantNum && candNum && wantNum === candNum) {
      score += 0.05;
    }
  }

  // Clamp to [0,1] — bonuses can push past 1.0 in degenerate cases.
  if (score > 1) score = 1;
  if (score < 0) score = 0;
  return { score, drug: cand };
}

// ── public API ────────────────────────────────────────────────────────

// R7hr-16: findDrug — main public entry. Returns
//   { drug: <plain object | null>, confidence: 0..1, alternatives: [...] }
// Never throws. Null winner when no candidate scored above the threshold
// (default 0.3) or the snapshot was empty.
async function findDrug(extractedName, opts = {}) {
  const empty = { drug: null, confidence: 0, alternatives: [] };
  if (!extractedName || typeof extractedName !== "string") return empty;

  const minConfidence = typeof opts.minConfidence === "number"
    ? opts.minConfidence
    : 0.0;

  let drugs = [];
  try {
    drugs = await _loadDrugs(opts);
  } catch (e) {
    // R7hr-16: defence in depth — _loadDrugs already swallows, but if a
    // sync throw sneaks in (mongoose validation on the find shape, say)
    // we still want a clean null instead of a 500.
    return empty;
  }
  if (!drugs.length) return empty;

  // Pre-compute extracted-side once — these are reused across every
  // candidate in the loop below.
  const extStripped = _stripFormPrefix(extractedName);
  const extTokens = _tokens(extStripped);
  if (!extTokens.length) return empty;
  const extFirst = extTokens[0];

  // R7hr-16: score every candidate. 5k drugs × ~10 µs/score = ~50 ms
  // worst case; cached snapshot keeps Mongo out of the loop entirely.
  const scored = new Array(drugs.length);
  for (let i = 0; i < drugs.length; i++) {
    scored[i] = _scoreCandidate(extTokens, extFirst, extStripped, drugs[i], opts);
  }

  // Sort descending by score. Stable enough — ties resolved by index
  // order which mirrors Mongo's natural-insertion order, deterministic
  // for a given snapshot.
  scored.sort((a, b) => b.score - a.score);

  const winner = scored[0];
  if (!winner || winner.score <= 0.3 || winner.score < minConfidence) {
    return empty;
  }

  // R7hr-16: top-3 alternatives EXCLUDING the winner. Filter > 0 so we
  // don't return literal zero-score garbage — the UI shows these as
  // "Did you mean…?" suggestions and zero-score is meaningless there.
  const alternatives = scored
    .slice(1, 4)
    .filter((s) => s.score > 0)
    .map((s) => ({ drug: s.drug, score: s.score }));

  return {
    drug: winner.drug,
    confidence: winner.score,
    alternatives,
  };
}

// R7hr-16: _resetCache — escape hatch for tests + admin tools that
// mutate the Drug master and want to see the change before TTL expires.
// Not on the default export to keep the surface area minimal; importable
// by name where needed.
function _resetCache() {
  _drugCache = null;
  _cacheLoadedAt = 0;
}

module.exports = {
  findDrug,
  // R7hr-16: helpers exposed for unit tests / debugging only. Production
  // callers should use findDrug. Names are underscore-prefixed to flag
  // their internal status.
  _tokens,
  _jaccard,
  _lev,
  _resetCache,
};
