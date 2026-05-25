// controllers/Common/pincodeController.js
// ────────────────────────────────────────────────────────────────
// R7dn — Pincode → address lookup endpoint.
//
// GET /api/pincode/:pincode
//   → { success: true, data: { pincode, city, district, state, country, source } }
//
// Lookup strategy (stop on first success that has all 3 fields,
// else accumulate partials):
//   1. Local MongoDB cache (PincodeMaster) — instant if previously fetched
//   2. api.postalpincode.in — best source, has city + district + state
//   3. nominatim.openstreetmap.org — reliable OSM, county ≈ district
//   4. api.zippopotam.us/in — last resort, has city + state only
//
// Successful result is cached in MongoDB forever. A row with partial
// data (e.g. zippopotam-only) gets upgraded automatically when a
// later request fetches richer data via a more comprehensive source.
//
// Public endpoint — no auth required. It's just postal lookup, not PHI.
// Rate-limited to 60/min/IP at the route layer.
// ────────────────────────────────────────────────────────────────
const PincodeMaster = require("../../models/Common/PincodeMasterModel");
// R7do — Bundled India Post pincode database (~19,300 entries, offline).
// Primary lookup source — instant, no network. If a pincode is missing
// from the bundled set (very rare), we fall through to the API chain.
const localIndianPincodes = require("india-pincode-search");

const VALID_PIN = /^\d{6}$/;
const TIMEOUT_MS = 4000;       // per-source hard cap
const UA         = "SphereHealth-HIS/1.0 (+pincode-lookup)";

// Title-case a SHOUTING-CASE string from India Post data.
// "UTTAR PRADESH" → "Uttar Pradesh", "NEW DELHI" → "New Delhi".
function titleCase(s) {
  if (!s) return "";
  return String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ── Source #0: Bundled local DB (india-pincode-search)
function lookupLocal(pin) {
  try {
    const matches = localIndianPincodes.search(pin);
    if (!Array.isArray(matches) || matches.length === 0) return null;
    // The local DB stores one row per post office. Pick the first
    // (typically the head office / GPO) for city naming, then take
    // district + state — those are identical across post offices in
    // the same pincode.
    const m = matches[0];
    if (!m.pincode) return null;
    return {
      city:     titleCase(m.city || m.village || ""),
      district: titleCase(m.district || ""),
      state:    titleCase(m.state || ""),
      country:  "India",
      source:   "local-india-post",
    };
  } catch (_) { return null; }
}

// AbortSignal.timeout polyfill — Node 18+ has it natively, but be safe.
function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

// ── Source #1: India Post (best data — has district)
async function fetchPostalPincode(pin) {
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: timeoutSignal(TIMEOUT_MS),
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (entry?.Status !== "Success" || !entry?.PostOffice?.length) return null;
    const po = entry.PostOffice[0];
    return {
      city:     po.Block || po.Division || po.Name || "",
      district: po.District || "",
      state:    po.State    || "",
      country:  po.Country  || "India",
      division: po.Division || "",
      block:    po.Block    || "",
      source:   "postalpincode",
    };
  } catch (_) { return null; }
}

// ── Source #2: Nominatim (OSM) — reliable, has county (district)
async function fetchNominatim(pin) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${pin}&country=India&format=json&addressdetails=1&limit=1`;
    const res = await fetch(url, {
      signal: timeoutSignal(TIMEOUT_MS),
      headers: { "User-Agent": UA }, // Nominatim REQUIRES a User-Agent
    });
    if (!res.ok) return null;
    const arr  = await res.json();
    const hit  = Array.isArray(arr) ? arr[0] : null;
    if (!hit) return null;
    const a = hit.address || {};
    return {
      city:     a.city || a.town || a.village || a.suburb || a.hamlet || "",
      district: a.state_district || a.county || a.district || "",
      state:    a.state || "",
      country:  a.country || "India",
      source:   "nominatim",
    };
  } catch (_) { return null; }
}

// ── Source #3: Zippopotam (last resort — no district)
async function fetchZippopotam(pin) {
  try {
    const res = await fetch(`https://api.zippopotam.us/in/${pin}`, {
      signal: timeoutSignal(TIMEOUT_MS),
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const place = Array.isArray(data?.places) ? data.places[0] : null;
    if (!place) return null;
    return {
      city:     place["place name"] || "",
      district: "",
      state:    place.state || "",
      country:  data.country || "India",
      source:   "zippopotam",
    };
  } catch (_) { return null; }
}

// Merge two partial result objects, preferring non-empty values.
// Used when a richer source can fill in fields the cache was missing.
function mergePartial(base, add) {
  if (!base) return add;
  if (!add)  return base;
  return {
    city:     base.city     || add.city     || "",
    district: base.district || add.district || "",
    state:    base.state    || add.state    || "",
    country:  base.country  || add.country  || "India",
    division: base.division || add.division || "",
    block:    base.block    || add.block    || "",
    // Keep the source of the row that filled district if we upgraded.
    source: base.district || !add.district ? base.source : add.source,
  };
}

exports.getPincodeLookup = async function (req, res) {
  const pin = String(req.params.pincode || "").trim();
  if (!VALID_PIN.test(pin)) {
    return res.status(400).json({ success: false, message: "Invalid pincode — must be 6 digits." });
  }

  // 1. Local bundled DB (india-pincode-search) — instant offline lookup.
  //    Covers ~19,300 Indian pincodes with city + district + state.
  //    This is now our primary source — APIs are just safety net for any
  //    edge case the local DB misses (newly-issued pincodes, etc).
  const local = lookupLocal(pin);
  if (local && local.city && local.state) {
    // Persist to MongoDB cache (idempotent — same data every time anyway).
    try {
      await PincodeMaster.updateOne(
        { pincode: pin },
        { $set: { pincode: pin, ...local } },
        { upsert: true },
      );
    } catch (_) { /* non-fatal */ }
    return res.json({ success: true, data: { pincode: pin, ...local }, cached: false, source: "local" });
  }

  // 2. MongoDB cache hit (only reached if local missed — typically never)
  try {
    const cached = await PincodeMaster.findOne({ pincode: pin }).lean();
    if (cached && cached.state) {
      return res.json({ success: true, data: cached, cached: true });
    }
  } catch (_) { /* cache lookup failed — fall through to fetch */ }

  // 3/4/5. API fetch chain — last-resort for pincodes missing from
  //        the bundled DB. Stop on first source that has district.
  let result = await fetchPostalPincode(pin);
  if (!result || !result.district) {
    const nom = await fetchNominatim(pin);
    result = mergePartial(result, nom);
  }
  if (!result || !result.state) {
    const zip = await fetchZippopotam(pin);
    result = mergePartial(result, zip);
  }

  if (!result || (!result.city && !result.state)) {
    return res.status(404).json({
      success: false,
      message: "Pincode not found via any source. Please fill manually.",
    });
  }

  // Cache for next time (upsert in case of race).
  try {
    await PincodeMaster.updateOne(
      { pincode: pin },
      { $set: { pincode: pin, ...result } },
      { upsert: true },
    );
  } catch (_) { /* non-fatal — return data anyway */ }

  res.json({ success: true, data: { pincode: pin, ...result }, cached: false });
};
