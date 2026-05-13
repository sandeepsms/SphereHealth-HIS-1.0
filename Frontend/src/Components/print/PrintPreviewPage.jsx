// Components/print/PrintPreviewPage.jsx
// Generic in-window print preview shell. Renders the toolbar (paper-size
// switcher + Print button) on top of the document body. Apply
// `data-paper` to <html> so print.css `@page` rules pick up the right
// size. Used by every printable below (OPDReceipt, PaymentReceipt, …)
// when opened in a /print/ route.

import React, { useEffect, useState } from "react";
import "./print.css";

const PAPERS = [
  { value: "a4",       label: "A4 portrait (210 × 297 mm)" },
  { value: "half-a4",  label: "Half A4 (210 × 148.5 mm)"   },
  { value: "a5",       label: "A5 portrait (148 × 210 mm)" },
];

const PrintPreviewPage = ({
  defaultPaper = "a4",
  toolbarTitle = "Print preview",
  children,
}) => {
  const [paper, setPaper] = useState(defaultPaper);

  useEffect(() => {
    document.documentElement.setAttribute("data-paper", paper);
    return () => {
      // leave attribute behind — only one tab usually
    };
  }, [paper]);

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
