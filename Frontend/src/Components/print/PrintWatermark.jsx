// Components/print/PrintWatermark.jsx
// ════════════════════════════════════════════════════════════════════
// R7bf-F / A4-CRIT-5: full-page "DUPLICATE" watermark for reprints of
// bills / receipts / lab reports / etc.
//
// GST Rules §48(4) requires every duplicate of a tax invoice to carry
// a "DUPLICATE FOR ..." stamp; NABH IMS.4 wants the same on every
// patient-facing reissued document. Pre-R7bf the first print and the
// 50th print looked identical — no way to spot a forgery on the floor.
//
// Behaviour:
//   • Renders nothing when printCount <= 1 (originals stay clean).
//   • Fixed-position rotated faded text — visible both on screen and
//     in print (`-webkit-print-color-adjust: exact` carries the
//     translucent fill through to the printer).
//   • `label` defaults to "DUPLICATE"; callers can pass "TRIPLICATE"
//     or "COPY N" for higher counts.
//   • `recipient` (optional) lets GST-strict bills render "DUPLICATE
//     FOR TRANSPORTER" / "DUPLICATE FOR SUPPLIER" etc.
//
// Mount inside PrintShell's body (or any printable's root). Z-index
// keeps the watermark behind text but above the page background so
// it shows on the printed paper.
// ════════════════════════════════════════════════════════════════════

import React from "react";

const PrintWatermark = ({
  printCount = 0,
  label,
  recipient,
}) => {
  if (!printCount || printCount <= 1) return null;

  // Compute a sensible label if the caller didn't supply one.
  // 1st print → no watermark (returned above).
  // 2nd print → DUPLICATE
  // 3rd print → TRIPLICATE
  // 4th+      → COPY N
  let resolved = label;
  if (!resolved) {
    if (printCount === 2) resolved = "DUPLICATE";
    else if (printCount === 3) resolved = "TRIPLICATE";
    else resolved = `COPY ${printCount}`;
  }

  const fullLabel = recipient ? `${resolved} FOR ${recipient}` : resolved;

  return (
    <div
      aria-hidden="true"
      className="pr-watermark"
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%) rotate(-30deg)",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontWeight: 900,
        fontSize: "100px",
        letterSpacing: "8px",
        color: "rgba(220, 38, 38, 0.15)",  // faded red, GST §48 idiom
        textShadow: "0 0 1px rgba(220, 38, 38, 0.25)",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: 0,
        whiteSpace: "nowrap",
        // -webkit-print-color-adjust on body already, but reasserting
        // here is harmless and forces the translucent colour through
        // even on browsers that ignore the global rule.
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {fullLabel}
    </div>
  );
};

export default PrintWatermark;
