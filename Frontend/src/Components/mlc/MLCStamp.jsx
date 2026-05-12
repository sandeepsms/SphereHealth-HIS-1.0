/**
 * MLCStamp — reusable medico-legal-case stamp
 *
 * Drop into ANY patient-document page that should carry the MLC mark
 * (clinical assessment, discharge summary, investigation report, prescription
 * print, OPD receipt, etc.). The stamp shows the unique MLR number and is
 * driven entirely by the css file (`mlc.css`) — no inline styles.
 *
 * Two visual modes:
 *   • `variant="watermark"` (default) — a circular fixed-position seal that
 *     "stamps" the page from the top-right corner. Best for screen + print.
 *   • `variant="banner"` — an inline strip you embed in the print header so
 *     it shows up in every printed page run.
 *
 * Usage:
 *   <MLCStamp mlrNumber={patient.mlcNumber} />            // watermark seal
 *   <MLCStamp mlrNumber={mlrNumber} variant="banner" date={mlcDate} />
 */
import React from "react";
import "../../pages/mlc/mlc.css";

export default function MLCStamp({
  mlrNumber,
  variant = "watermark",
  date,
  doctor,
}) {
  if (!mlrNumber) return null;

  if (variant === "banner") {
    return (
      <div className="mlc-stamp-banner">
        <div>
          <div className="mlc-stamp-banner-title">⚖ Medico-Legal Case</div>
          {(date || doctor) && (
            <div className="rx-text-subtle">
              {date && <>Issued: {new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</>}
              {date && doctor && " · "}
              {doctor && <>By: <strong>{doctor}</strong></>}
            </div>
          )}
        </div>
        <div className="mlc-stamp-banner-mlr">MLR&nbsp;No.&nbsp;{mlrNumber}</div>
      </div>
    );
  }

  return (
    <div className="mlc-stamp" aria-hidden="true">
      <div className="mlc-stamp-title">MLC</div>
      <div className="mlc-stamp-mlr">{mlrNumber}</div>
      <div className="mlc-stamp-sub">MEDICO-LEGAL</div>
    </div>
  );
}
