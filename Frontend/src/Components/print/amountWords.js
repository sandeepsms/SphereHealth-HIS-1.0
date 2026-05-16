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

export function amountInWords(amount) {
  const num = Math.max(0, Math.floor(Number(amount) || 0));
  if (num === 0) return "Zero Rupees Only";
  let n = num;
  const parts = [];
  if (n >= 10000000) { parts.push(under1000(Math.floor(n / 10000000)) + " Crore");  n %= 10000000; }
  if (n >= 100000)   { parts.push(under1000(Math.floor(n / 100000))   + " Lakh");   n %= 100000;   }
  if (n >= 1000)     { parts.push(under1000(Math.floor(n / 1000))     + " Thousand"); n %= 1000;   }
  if (n > 0)         { parts.push(under1000(n)); }
  return parts.join(" ") + " Rupees Only";
}

export const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
