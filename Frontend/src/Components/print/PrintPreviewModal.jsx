// Components/print/PrintPreviewModal.jsx
// ════════════════════════════════════════════════════════════════════
// R7bf-F / A4-MED-1: iframe modal alternative to the new-tab print
// flow. Most browsers will pop-up-block window.open() under user
// interaction sometimes; embedded iframes never trip the blocker.
//
// Usage:
//   <PrintPreviewModal
//     open={open}
//     slug="opd-receipt"
//     payload={billPayload}
//     onClose={() => setOpen(false)}
//   />
//
// The iframe loads /print/<slug> in-document, so the print
// pipeline's session-storage handshake works exactly as in the
// new-tab path — the host page sets `printPayload-<slug>` BEFORE
// mounting this modal, and the iframe reads it from the same
// sessionStorage instance.
// ════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from "react";

const PrintPreviewModal = ({ open, slug, payload, onClose }) => {
  const iframeRef = useRef(null);

  // Stash the payload in sessionStorage so the iframe-mounted
  // PrintRouterPage picks it up the same way the new-tab path does.
  useEffect(() => {
    if (!open || !slug) return;
    try {
      if (payload != null) {
        sessionStorage.setItem(`printPayload-${slug}`, JSON.stringify(payload));
      }
    } catch { /* sessionStorage unavailable */ }
  }, [open, slug, payload]);

  // Press Esc to close (matches modal idioms in the rest of the app).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const ts = Date.now();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Print preview"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={(e) => {
        // Click on the backdrop closes; clicks inside the panel don't.
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: "min(1100px, 100%)",
          background: "white",
          borderRadius: 10,
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.35)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", background: "#0f172a", color: "white",
        }}>
          <strong style={{ fontSize: 13, letterSpacing: ".3px" }}>
            Print Preview · {slug}
          </strong>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                try { iframeRef.current?.contentWindow?.print(); } catch (_e) {}
              }}
              style={{
                background: "white", color: "#0f172a",
                border: "none", padding: "6px 14px",
                borderRadius: 6, fontWeight: 700, cursor: "pointer",
              }}
            >Print</button>
            <button
              onClick={onClose}
              style={{
                background: "transparent", color: "white",
                border: "1.5px solid rgba(255,255,255,.45)",
                padding: "6px 14px", borderRadius: 6, cursor: "pointer",
              }}
            >Close</button>
          </div>
        </div>
        <iframe
          ref={iframeRef}
          title="Print preview"
          src={`/print/${encodeURIComponent(slug)}?ts=${ts}`}
          style={{ flex: 1, width: "100%", border: "none", background: "#f1f5f9" }}
        />
      </div>
    </div>
  );
};

export default PrintPreviewModal;
