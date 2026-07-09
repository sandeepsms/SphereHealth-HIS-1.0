// utils/labNarrative.js
// R7hr(LAB-P2) — turn a patient's lab trend sheets (GET /lab-records/trends)
// into a CHRONOLOGICAL, plain-language paragraph. Each reading is phrased
// with a light explanation of where it sits versus its reference range
// (low / high / critically high, etc.), so the Investigations section reads
// like a clinician's running summary instead of a raw grid.
//
// The trends feed is the ONLY source carrying units + reference ranges +
// per-reading status, so this is where a range-aware narrative must come
// from (the /admission-investigations aggregate has already dropped them).

const fmtD = (d) => {
  try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return String(d); }
};

// Plain-language position vs the reference interval. Empty string when the
// value is qualitative or the test has no numeric range (nothing to explain).
function explain(value, refMin, refMax, status) {
  const n = parseFloat(value);
  if (isNaN(n) || refMin == null || refMax == null) return "";
  const high = n > refMax, low = n < refMin;
  if (status === "critical") return high ? "critically high" : low ? "critically low" : "critical";
  if (high) return "high";
  if (low)  return "low";
  if (status === "borderline") return "borderline";
  return "normal";
}

/**
 * @param {Array} trends  the array from GET /lab-records/trends (LabTrend docs)
 * @param {object} opts   { maxDates } cap on how many recent dates to narrate
 * @returns {string} paragraph text ("" when there's nothing numeric to say)
 */
export function buildChronologicalLabNarrative(trends, { maxDates = 14 } = {}) {
  if (!Array.isArray(trends) || !trends.length) return "";

  const byDate = new Map();          // dateKey -> readings[]
  const series = new Map();          // "Test (unit)" -> [{date,value}]
  for (const tr of trends) {
    for (const t of (tr.tests || [])) {
      for (const rd of (t.readings || [])) {
        if (rd.value === "" || rd.value == null) continue;
        const dk = new Date(rd.date).toISOString().slice(0, 10);
        if (!byDate.has(dk)) byDate.set(dk, []);
        byDate.get(dk).push({ test: t.name, value: rd.value, unit: t.unit, refMin: t.refMin, refMax: t.refMax, status: rd.status });
        const key = `${t.name}${t.unit ? " (" + t.unit + ")" : ""}`;
        if (!series.has(key)) series.set(key, []);
        series.get(key).push({ date: dk, value: rd.value });
      }
    }
  }
  if (!byDate.size) return "";

  const dateKeys = Array.from(byDate.keys()).sort().slice(-maxDates);   // ascending, capped to recent
  const sentences = dateKeys.map((dk) => {
    const parts = byDate.get(dk).map((it) => {
      const ex = explain(it.value, it.refMin, it.refMax, it.status);
      const abnormal = ex && ex !== "normal";
      const range = (it.refMin != null && it.refMax != null) ? `, ref ${it.refMin}–${it.refMax}` : "";
      const unit = it.unit ? ` ${it.unit}` : "";
      return `${it.test} ${it.value}${unit}${abnormal ? ` (${ex}${range})` : ""}`;
    });
    return `On ${fmtD(dk)}, ${parts.join("; ")}.`;
  });

  // closing trend line for tests whose first and last recorded values differ
  const trendBits = [];
  for (const [key, arr] of series) {
    const s = arr.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (s.length >= 2 && String(s[0].value) !== String(s[s.length - 1].value)) {
      const a = parseFloat(s[0].value), b = parseFloat(s[s.length - 1].value);
      const dir = (!isNaN(a) && !isNaN(b)) ? (b > a ? "rose" : b < a ? "fell" : "changed") : "changed";
      trendBits.push(`${key} ${dir} from ${s[0].value} to ${s[s.length - 1].value}`);
    }
  }

  let out = sentences.join(" ");
  if (trendBits.length) out += `\n\nTrend over the stay: ${trendBits.join("; ")}.`;
  return out;
}
