// Components/print/PrintPreviewPage.jsx
// Generic in-window print preview shell. Renders the toolbar (paper-size
// switcher + orientation toggle + Print button) on top of the document
// body. Sets `data-paper` and `data-orient` on <html> so print.css
// `@page` rules + per-printable CSS pick up the right size + orientation.
//
// Half-A4 paper has a special "Double on A4" mode (default ON) that
// prints the same receipt TWICE on a single A4 sheet — top half and
// bottom half with a dashed cut-line between them. Saves paper for
// receipts that the patient + pharmacy both want a copy of. The CSS
// switches @page to A4 portrait when this is active.

import React, { useEffect, useState } from "react";
import "./print.css";

const PAPERS = [
  { value: "a4",       label: "A4 (210 × 297 mm)"           },
  { value: "half-a4",  label: "Half A4 (210 × 148.5 mm)"    },
  { value: "a5",       label: "A5 (148 × 210 mm)"           },
];
const ORIENTATIONS = [
  { value: "portrait",  label: "Portrait",  icon: "▮" },
  { value: "landscape", label: "Landscape", icon: "▭" },
];

const PrintPreviewPage = ({
  defaultPaper = "a4",
  defaultOrient = "portrait",
  toolbarTitle = "Print preview",
  children,
}) => {
  const [paper,  setPaper]  = useState(defaultPaper);
  const [orient, setOrient] = useState(defaultOrient);
  // Double-on-A4 is opt-in, not opt-out. Operators print single copies
  // by default; if they want two halves on one A4 for paper saving,
  // they tick the toolbar checkbox before clicking Print.
  const [doubleOnA4, setDoubleOnA4] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-paper",  paper);
    document.documentElement.setAttribute("data-orient", orient);
    // `data-duplicate` only takes effect for half-A4; the CSS rules
    // gate on both data-paper="half-a4" AND data-duplicate="on".
    document.documentElement.setAttribute(
      "data-duplicate",
      paper === "half-a4" && doubleOnA4 ? "on" : "off",
    );
  }, [paper, orient, doubleOnA4]);

  const isHalf      = paper === "half-a4";
  const showDouble  = isHalf && doubleOnA4;

  return (
    <>
      <div className="pr-toolbar pr-no-print">
        <span className="pr-toolbar__title">🖨 {toolbarTitle}</span>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
          Paper:
          <select value={paper} onChange={(e) => setPaper(e.target.value)}>
            {PAPERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        {/* Orientation pill toggle */}
        <div style={{ display: "inline-flex", border: "1.5px solid #cbd5e1", borderRadius: 6, overflow: "hidden" }}>
          {ORIENTATIONS.map(o => {
            const active = orient === o.value;
            return (
              <button key={o.value} onClick={() => setOrient(o.value)}
                title={o.label}
                style={{
                  padding: "5px 12px", border: "none",
                  background: active ? "#1d4ed8" : "#fff",
                  color: active ? "#fff" : "#475569",
                  fontWeight: 700, fontSize: 11, cursor: "pointer",
                  letterSpacing: ".3px",
                }}>
                {o.icon} {o.label}
              </button>
            );
          })}
        </div>

        {/* Eco-print toggle — visible only on Half-A4 */}
        {isHalf && (
          <label
            title="Print the same receipt twice on a single A4 sheet — patient + pharmacy each get a copy."
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 10px", border: `1.5px solid ${doubleOnA4 ? "#16a34a" : "#cbd5e1"}`,
              borderRadius: 6, background: doubleOnA4 ? "#dcfce7" : "#fff",
              color: doubleOnA4 ? "#166534" : "#475569",
              fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: ".2px",
            }}>
            <input type="checkbox" checked={doubleOnA4}
              onChange={(e) => setDoubleOnA4(e.target.checked)}
              style={{ accentColor: "#16a34a", margin: 0 }} />
            🌿 Double on A4
          </label>
        )}

        <button onClick={() => window.close()}>Close</button>
        <button className="primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      {/* Document body — single copy by default. When Double-on-A4 is
          active for Half-A4, a clone is rendered after the original
          with a dashed cut-line in between. The clone is purely visual
          (no React state inside the printables) so re-rendering is safe. */}
      <div className="pr-doc">
        <div className="pr-doc-copy">{children}</div>
        {showDouble && (
          <>
            <div className="pr-doc-cutline pr-no-print-fold">
              <span>✂ cut here</span>
            </div>
            <div className="pr-doc-copy pr-doc-copy--duplicate" aria-hidden="true">
              {children}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default PrintPreviewPage;
