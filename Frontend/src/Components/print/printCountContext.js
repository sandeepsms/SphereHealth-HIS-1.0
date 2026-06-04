// Components/print/printCountContext.js
// ════════════════════════════════════════════════════════════════════
// R7hr-12 (D7-02): React Context that lets PrintPreviewPage /
// PrintPreviewModal surface the post-bump printCount (the value the
// /api/print-audit POST returned) into the rendered subtree BEFORE
// window.print() fires.
//
// Why this exists:
//   Before R7hr-12 the Print button awaited recordPrintAudit() but
//   discarded the response. Every printable downstream read
//   `receipt.printCount` from the payload that was stashed in
//   sessionStorage when the preview opened — which is the PRE-bump
//   value. Result: the very first reprint of any entity (pharmacy
//   bill, OPD receipt, advance receipt, refund, lab report, IPD final
//   bill, etc.) silently printed without the GST §48(4) DUPLICATE
//   watermark, indistinguishable from the original on paper.
//
// How it works:
//   • PrintPreviewPage holds `printCountOverride` in React state.
//   • On Print click: await recordPrintAudit(), capture the returned
//     printCount, setState. The next render flows the new value into
//     the PrintCountContext.Provider that wraps `children`.
//   • PrintWatermark.jsx reads this Context. If it sees a number it
//     uses that in preference to the `printCount` prop — so every
//     existing <PrintWatermark> instance gets the corrected value
//     without each printable having to be touched.
//   • PrintPreviewPage waits one animation frame (so React commits
//     the new tree) before calling window.print().
//
// Default value is `null` — Context "not provided" — which means the
// PrintWatermark falls back to its `printCount` prop (legacy behaviour
// for any consumer outside the preview shell).
// ════════════════════════════════════════════════════════════════════
import { createContext, useContext } from "react";

export const PrintCountContext = createContext(null);

/**
 * Resolve the effective printCount: if the preview shell has provided
 * a post-bump override via Context, use it; otherwise fall back to the
 * prop the printable already passes (the pre-bump value from payload).
 */
export function useEffectivePrintCount(propValue) {
  const override = useContext(PrintCountContext);
  if (override != null && Number.isFinite(Number(override))) {
    return Number(override);
  }
  return Number(propValue) || 0;
}
