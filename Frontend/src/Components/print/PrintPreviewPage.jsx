// Components/print/PrintPreviewPage.jsx
// Generic in-window print preview shell. Renders the toolbar (paper-size
// switcher + orientation toggle + Print button) on top of the document
// body. Sets `data-paper` and `data-orient` on <html> so print.css
// `@page` rules + per-printable CSS pick up the right size + orientation.

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

  useEffect(() => {
    document.documentElement.setAttribute("data-paper",  paper);
    document.documentElement.setAttribute("data-orient", orient);
  }, [paper, orient]);

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

        <button onClick={() => window.close()}>Close</button>
        <button className="primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <div>{children}</div>
    </>
  );
};

export default PrintPreviewPage;
