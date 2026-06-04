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

import React, { useEffect, useRef, useState } from "react";
import { recordPrintAudit } from "../../utils/printUtils";

const PrintPreviewModal = ({ open, slug, payload, onClose }) => {
  const iframeRef = useRef(null);
  // R7bh-F1 / META-1 (R7bg-7-CRIT-8): pre-R7bh the modal Print
  // button called `iframe.contentWindow.print()` directly, bypassing
  // `recordPrintAudit()` — so any operator using the modal-preview
  // path (vs new-tab path) never bumped the entity's printCount, no
  // PrintAudit row landed, DUPLICATE watermark never rendered. Mirror
  // the audit-then-print sequence that PrintPreviewPage already does.
  const [auditing, setAuditing] = useState(false);
  // R7hr-12 (D7-02): iframe src timestamp lifted into state so we can
  // mutate it post-audit to force a reload of the embedded
  // PrintRouterPage with the bumped printCount in sessionStorage.
  // Re-initialised every time the modal opens for a fresh ts.
  const [iframeTs, setIframeTs] = useState(() => Date.now());
  useEffect(() => {
    if (open) setIframeTs(Date.now());
  }, [open, slug]);

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

  const handlePrint = async () => {
    // R7bh-F1 / META-1: audit BEFORE iframe.print() so the post-bump
    // printCount is what the watermark renders against (matches the
    // new-tab path in PrintPreviewPage). Audit failures never block.
    const audit = payload?.printAudit;
    if (audit?.entityType && audit?.entityId) {
      setAuditing(true);
      let postBumpCount = null;
      try {
        const res = await recordPrintAudit(audit);
        if (res && Number.isFinite(Number(res.printCount))) {
          postBumpCount = Number(res.printCount);
        }
      } catch (_e) { /* swallow — never block print */ }
      setAuditing(false);

      // R7hr-12 (D7-02): the iframe is a separate document so React
      // Context cannot reach it (unlike PrintPreviewPage). Instead,
      // rewrite the sessionStorage payload with the post-bump
      // printCount and reload the iframe so PrintRouterPage re-mounts
      // and PharmacyBill / OPDReceipt / etc. re-render PrintWatermark
      // against the corrected count. Pre-fix the first reprint via
      // the modal path printed without the GST §48(4) watermark.
      if (postBumpCount != null && slug) {
        try {
          const raw = sessionStorage.getItem(`printPayload-${slug}`);
          if (raw) {
            const cur = JSON.parse(raw);
            const patched = { ...cur, printCount: postBumpCount };
            sessionStorage.setItem(`printPayload-${slug}`, JSON.stringify(patched));
          }
        } catch (_e) { /* sessionStorage unavailable — best effort */ }
        // Force iframe reload and wait for it to finish painting.
        await new Promise((resolve) => {
          const iframe = iframeRef.current;
          if (!iframe) { resolve(); return; }
          const onLoad = () => {
            iframe.removeEventListener("load", onLoad);
            // Two rAFs after load so React inside the iframe commits
            // and paints the watermark before window.print() snaps.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve())
            );
          };
          iframe.addEventListener("load", onLoad);
          setIframeTs(Date.now());
          // Safety timeout — never block the user forever.
          setTimeout(() => {
            iframe.removeEventListener("load", onLoad);
            resolve();
          }, 2500);
        });
      }
    }
    try { iframeRef.current?.contentWindow?.print(); } catch (_e) {}
  };

  if (!open) return null;
  const ts = iframeTs;

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
              onClick={handlePrint}
              disabled={auditing}
              style={{
                background: "white", color: "#0f172a",
                border: "none", padding: "6px 14px",
                borderRadius: 6, fontWeight: 700,
                cursor: auditing ? "wait" : "pointer",
                opacity: auditing ? 0.7 : 1,
              }}
            >{auditing ? "Recording…" : "Print"}</button>
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
