/**
 * utils/gstState.js — canonical GST state-code normalisation.
 *
 * R9-FIX(R9-033): the R7bm-F7 state-code normalisation (accepting "29-KA",
 * "Karnataka", "KA", etc. and collapsing to the 2-digit GSTN code) originally
 * lived ONLY in gstr1Exporter. Its siblings — gstService (pharmacy GSTR-1
 * aggregation), gstr3bExporter, and PatientBill.recalcTotals — compared the
 * raw process.env.HOSPITAL_STATE_CODE / placeOfSupply strings directly, so a
 * hospital configured as "29-Karnataka" (or an invoice whose placeOfSupply was
 * a state NAME) was mis-classified inter-state vs intra-state → wrong CGST/SGST
 * vs IGST split in exactly the places GSTR-1 didn't. This module is the single
 * source of truth all four now consume.
 */
"use strict";

// State/UT name (upper-cased, separators normalised) → 2-digit GSTN code.
const GST_STATE_CODE_MAP = {
  "JAMMU AND KASHMIR": "01", "JAMMU & KASHMIR": "01", "J&K": "01",
  "HIMACHAL PRADESH": "02", "HP": "02",
  "PUNJAB": "03",
  "CHANDIGARH": "04",
  "UTTARAKHAND": "05", "UTTRAKHAND": "05",
  "HARYANA": "06",
  "DELHI": "07",
  "RAJASTHAN": "08",
  "UTTAR PRADESH": "09", "UP": "09",
  "BIHAR": "10",
  "SIKKIM": "11",
  "ARUNACHAL PRADESH": "12",
  "NAGALAND": "13",
  "MANIPUR": "14",
  "MIZORAM": "15",
  "TRIPURA": "16",
  "MEGHALAYA": "17",
  "ASSAM": "18",
  "WEST BENGAL": "19", "WB": "19",
  "JHARKHAND": "20",
  "ODISHA": "21", "ORISSA": "21",
  "CHATTISGARH": "22", "CHHATTISGARH": "22",
  "MADHYA PRADESH": "23", "MP": "23",
  "GUJARAT": "24",
  "DAMAN AND DIU": "25", "DAMAN & DIU": "25",
  "DADRA AND NAGAR HAVELI": "26", "DADRA & NAGAR HAVELI": "26",
  "MAHARASHTRA": "27",
  "ANDHRA PRADESH (BEFORE)": "28",
  "KARNATAKA": "29", "KA": "29",
  "GOA": "30",
  "LAKSHADWEEP": "31",
  "KERALA": "32",
  "TAMIL NADU": "33", "TN": "33",
  "PUDUCHERRY": "34", "PONDICHERRY": "34",
  "ANDAMAN AND NICOBAR ISLANDS": "35", "ANDAMAN & NICOBAR": "35",
  "TELANGANA": "36",
  "ANDHRA PRADESH": "37", "AP": "37",
  "LADAKH": "38",
  "OTHER TERRITORY": "97", "FOREIGN COUNTRY": "96", "OIDAR": "99",
};

/**
 * Normalise a state value (string) into the canonical 2-digit GST state code.
 * Accepts:
 *   - "29", "29 ", "29-KA", "29-Karnataka", "29|KA" → "29"
 *   - "Karnataka", "karnataka", "KA"               → "29"
 *   - anything that already matches \d{2}          → kept verbatim
 * Returns "" when the input cannot be resolved — caller decides how to react.
 */
function normalizeGstStateCode(raw) {
  if (raw == null) return "";
  const s = String(raw).trim().toUpperCase();
  if (!s) return "";
  // Prefix-digit form: "29-KA", "29|KA", "29 KA", "29Karnataka"
  const prefixMatch = s.match(/^(\d{2})\b/);
  if (prefixMatch) {
    const code = prefixMatch[1];
    if (Number(code) >= 1 && Number(code) <= 99) return code;
  }
  // Pure name lookup (with separators removed): "WEST BENGAL", "TAMIL_NADU"
  const nameKey = s.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (GST_STATE_CODE_MAP[nameKey]) return GST_STATE_CODE_MAP[nameKey];
  // Strip non-letters and retry
  const lettersKey = s.replace(/[^A-Z]/g, "");
  for (const [k, v] of Object.entries(GST_STATE_CODE_MAP)) {
    if (k.replace(/[^A-Z]/g, "") === lettersKey) return v;
  }
  // Fall-through: numeric-only string of arbitrary length — keep first two
  // digits if they look like a valid code, otherwise unresolved.
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 2) {
    const code = digits.slice(0, 2);
    if (Number(code) >= 1 && Number(code) <= 99) return code;
  }
  return "";
}

/**
 * Intra-state test used by the CGST/SGST-vs-IGST decision. Returns true only
 * when both sides resolve to the SAME canonical code. If EITHER side is empty
 * after normalisation, returns `defaultIntra` (default true — the legacy
 * "assume intra-state" behaviour) so a missing placeOfSupply keeps behaving as
 * it did before, rather than silently flipping a bill to inter-state IGST.
 */
function sameGstState(aRaw, bRaw, { defaultIntra = true } = {}) {
  const a = normalizeGstStateCode(aRaw);
  const b = normalizeGstStateCode(bRaw);
  if (!a || !b) return defaultIntra;
  return a === b;
}

module.exports = { GST_STATE_CODE_MAP, normalizeGstStateCode, sameGstState };
