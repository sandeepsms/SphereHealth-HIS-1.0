// Convert a number (in rupees) to Indian English words.
// Used in receipts: "Five Hundred Twenty-Five Rupees Only".

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under1000(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return (TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")).trim();
  return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + under1000(n % 100) : "");
}

// R7da — Decimal128-aware number coercion. PatientBill / PharmacySale
// money fields are stored as Mongoose Decimal128. When the backend
// returns those docs via `.lean()` the toJSON transform is bypassed and
// the field surfaces as the raw wire format: { $numberDecimal: "320" }.
// Number({ $numberDecimal: "320" }) === NaN — that's the "₹NaN" the
// pharmacist saw in receipts + the sales register. Unwrap before
// numeric coercion so every consumer of fmtINR / amountInWords stays safe.
function _toNumDec(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
  if (typeof v === "object") {
    // Mongo wire format
    if (typeof v.$numberDecimal === "string") return parseFloat(v.$numberDecimal) || 0;
    // Mongoose Decimal128 instance — .toString() works on both server + client
    if (typeof v.toString === "function") {
      const n = parseFloat(v.toString());
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

export function amountInWords(amount) {
  const num = Math.max(0, Math.floor(_toNumDec(amount)));
  if (num === 0) return "Zero Rupees Only";
  let n = num;
  const parts = [];
  if (n >= 10000000) { parts.push(under1000(Math.floor(n / 10000000)) + " Crore");  n %= 10000000; }
  if (n >= 100000)   { parts.push(under1000(Math.floor(n / 100000))   + " Lakh");   n %= 100000;   }
  if (n >= 1000)     { parts.push(under1000(Math.floor(n / 1000))     + " Thousand"); n %= 1000;   }
  if (n > 0)         { parts.push(under1000(n)); }
  return parts.join(" ") + " Rupees Only";
}

// R7da — _toNumDec ensures Decimal128 wire format ({$numberDecimal:"320"})
// is unwrapped before toLocaleString, preventing "₹NaN" on bill prints
// and the sales register.
export const fmtINR = (n) => `₹${_toNumDec(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
