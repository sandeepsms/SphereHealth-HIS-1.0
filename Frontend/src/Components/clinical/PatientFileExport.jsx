/**
 * PatientFileExport — single component for printing, PDF download, and
 * QR-share of a patient's full file.
 *
 * Drop into ANY patient page (DoctorPatientPanel, NursePatientPanel,
 * AllPatients view modal, etc.):
 *
 *   <PatientFileExport
 *     patient={patient}          // { _id, UHID, fullName, ... }
 *     printRef={refToPrintArea}  // React ref pointing at the DOM node to print
 *     title="Patient File"       // optional
 *   />
 *
 * 3 buttons rendered:
 *
 *   • Print     — opens browser print dialog on the referenced area
 *   • PDF       — converts the area to a PDF using html2pdf.js
 *   • Share QR  — opens a modal with a QR code that links to
 *                 /patient-history?uhid=… so the recipient can open
 *                 the live timeline (same data, always up to date).
 *
 * No inline JS styles for layout — everything lives in
 * patient-file-print.css.
 */

import React, { useState, useMemo, useCallback } from "react";
import { toast } from "react-toastify";
import { logActivity } from "../../utils/activityLogger";
import "./patient-file-print.css";

const QR_BASE = "https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=";

export default function PatientFileExport({ patient, printRef, title = "Patient File" }) {
  const [busy, setBusy] = useState("");      // "print" | "pdf" | ""
  const [showQR, setShowQR] = useState(false);

  // Always-fresh share URL. Recipient opens this and the SPA
  // navigates to the patient-history timeline.
  const shareUrl = useMemo(() => {
    if (!patient?.UHID) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/patient-history?uhid=${encodeURIComponent(patient.UHID)}`;
  }, [patient?.UHID]);

  const qrSrc = useMemo(() => (shareUrl ? `${QR_BASE}${encodeURIComponent(shareUrl)}` : ""), [shareUrl]);

  const filename = useMemo(() => {
    const safe = (s) => String(s || "").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40);
    const date = new Date().toISOString().slice(0, 10);
    return `${safe(patient?.UHID || "patient")}_${safe(patient?.fullName)}_${date}.pdf`;
  }, [patient]);

  /** Print just the referenced DOM area, not the whole SPA chrome.
   *  In an SPA, the print region is nested deep inside #root, so a
   *  simple `body > *:not(.pfe-printable)` CSS rule would hide the
   *  whole tree. Instead we mark every ancestor of the print region
   *  with `.pfe-printable-ancestor` so they remain visible during
   *  print, and clean those classes up afterward.
   */
  const onPrint = useCallback(() => {
    const node = printRef?.current;
    if (!node) {
      window.print();
      return;
    }
    // Re-entry guard — if a previous print is still cleaning up, the
    // 60s safety timer for THIS invocation could strip classes mid-second-
    // print and produce a blank page. Block until prior cleanup finishes.
    if (document.body.classList.contains("pfe-printing")) {
      toast.info("A print is already in progress — please wait");
      return;
    }
    setBusy("print");
    // Audit: who hit print on whose chart, and when. (NABH AAC.7 — record
    // disclosure trail). Fire-and-forget — never blocks the print dialog.
    if (patient?.UHID) {
      logActivity({
        uhid: patient.UHID,
        module: "PatientFileExport",
        action: "print",
        area: "print-button",
        summary: `Print initiated — ${title}`,
      });
    }
    const ancestors = [];
    try {
      // Walk from the print region up to <body>, tagging each ancestor.
      let cur = node.parentElement;
      while (cur && cur !== document.body) {
        cur.classList.add("pfe-printable-ancestor");
        ancestors.push(cur);
        cur = cur.parentElement;
      }
      document.body.classList.add("pfe-printing");
      node.classList.add("pfe-printable");
      // Defer so the classes flush before the browser snapshots layout
      setTimeout(() => {
        window.print();
        const cleanup = () => {
          document.body.classList.remove("pfe-printing");
          node.classList.remove("pfe-printable");
          ancestors.forEach((el) => el.classList.remove("pfe-printable-ancestor"));
          window.removeEventListener("afterprint", cleanup);
          setBusy("");
        };
        window.addEventListener("afterprint", cleanup);
        // Safety net — some browsers don't fire afterprint reliably.
        setTimeout(cleanup, 60_000);
      }, 50);
    } catch (e) {
      // Make sure we don't leave the SPA stuck in print mode if we threw
      document.body.classList.remove("pfe-printing");
      node?.classList.remove("pfe-printable");
      ancestors.forEach((el) => el.classList.remove("pfe-printable-ancestor"));
      toast.error("Print failed: " + (e?.message || "unknown"));
      setBusy("");
    }
  }, [printRef]);

  /** Render the referenced area to a downloadable PDF. */
  const onPdf = useCallback(async () => {
    const node = printRef?.current;
    if (!node) {
      toast.warning("Nothing to export yet");
      return;
    }
    setBusy("pdf");
    // Audit: PDF downloads are a NABH AAC.7 disclosure event — log them.
    if (patient?.UHID) {
      logActivity({
        uhid: patient.UHID,
        module: "PatientFileExport",
        action: "export",
        area: "pdf-download",
        summary: `PDF export — ${filename}`,
      });
    }
    try {
      // html2pdf is bundled (Frontend/package.json: "html2pdf.js": "^0.13.0").
      // Lazy import keeps the main bundle smaller.
      const { default: html2pdf } = await import("html2pdf.js");
      await html2pdf()
        .set({
          margin:      [10, 10, 14, 10],
          filename,
          image:       { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak:   { mode: ["css", "legacy"] },
        })
        .from(node)
        .save();
      toast.success("PDF saved");
    } catch (e) {
      toast.error("PDF export failed: " + (e?.message || "unknown"));
    } finally {
      setBusy("");
    }
  }, [printRef, filename]);

  /** Show / hide the QR modal. */
  const onShare = useCallback(() => {
    if (patient?.UHID) {
      logActivity({
        uhid: patient.UHID,
        module: "PatientFileExport",
        action: "click",
        area: "qr-share.open",
        summary: "Opened QR share dialog",
      });
    }
    setShowQR(true);
  }, [patient?.UHID]);

  /** Copy the share URL to clipboard. */
  const onCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      // FIX (audit P28-B4): `navigator.clipboard` is undefined on plain
      // HTTP intranet contexts (typical hospital LAN). Fall back to a
      // hidden textarea + document.execCommand("copy") which works
      // everywhere.
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand copy returned false");
      }
      toast.success("Link copied — share via WhatsApp / SMS");
      // Sharing the link off-system is a NABH disclosure event.
      if (patient?.UHID) {
        logActivity({
          uhid: patient.UHID,
          module: "PatientFileExport",
          action: "export",
          area: "qr-share.link-copied",
          summary: "Patient timeline link copied to clipboard",
          tags: ["disclosure"],
          isFlagged: true,
        });
      }
    } catch {
      toast.error("Could not access clipboard — please copy manually");
    }
  }, [shareUrl]);

  if (!patient) return null;

  return (
    <>
      <div className="pfe-actions">
        <button className="pfe-btn pfe-btn--print" onClick={onPrint} disabled={busy === "print"}>
          <i className={`pi ${busy === "print" ? "pi-spin pi-spinner" : "pi-print"}`} /> Print
        </button>
        <button className="pfe-btn pfe-btn--pdf" onClick={onPdf} disabled={busy === "pdf"}>
          <i className={`pi ${busy === "pdf" ? "pi-spin pi-spinner" : "pi-file-pdf"}`} /> PDF
        </button>
        <button className="pfe-btn pfe-btn--qr" onClick={onShare}>
          <i className="pi pi-qrcode" /> Share QR
        </button>
      </div>

      {showQR && (
        <div className="pfe-modal-backdrop" onClick={() => setShowQR(false)}>
          <div className="pfe-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pfe-modal-head">
              <i className="pi pi-qrcode" />
              <span className="pfe-modal-title">{title} · Share via QR</span>
              <button className="pfe-modal-close" onClick={() => setShowQR(false)} aria-label="close">×</button>
            </div>
            <div className="pfe-modal-body">
              <div className="pfe-qr-card">
                {qrSrc ? (
                  <img
                    src={qrSrc}
                    alt={`QR for ${patient.fullName} (${patient.UHID})`}
                    className="pfe-qr-img"
                    onError={(e) => {
                      // FIX (audit P28-B3): graceful failure if the external
                      // QR API is unreachable (firewall / offline). Swap to
                      // a fallback message instead of a broken image icon.
                      e.currentTarget.outerHTML =
                        '<div class="pfe-qr-placeholder">QR service unreachable — share the link below directly.</div>';
                    }}
                  />
                ) : (
                  <div className="pfe-qr-placeholder">No UHID — cannot build a sharable link.</div>
                )}
                <div className="pfe-qr-caption">
                  <div className="pfe-qr-name">{patient.title || ""} {patient.fullName}</div>
                  <div className="pfe-qr-uhid">UHID&nbsp;<strong>{patient.UHID}</strong></div>
                </div>
              </div>

              <div className="pfe-share-block">
                <label className="pfe-share-label">Direct link</label>
                <div className="pfe-share-row">
                  <input className="pfe-share-input" value={shareUrl} readOnly onFocus={(e) => e.target.select()} />
                  <button className="pfe-btn pfe-btn--small" onClick={onCopy}>
                    <i className="pi pi-copy" /> Copy
                  </button>
                </div>
                <div className="pfe-share-help">
                  Recipient opens this link and lands on the patient's live
                  visit history (OPD + IPD + ER) — always up to date.
                </div>
              </div>
            </div>
            <div className="pfe-modal-foot">
              <button className="pfe-btn pfe-btn--ghost" onClick={() => setShowQR(false)}>Close</button>
              <button className="pfe-btn pfe-btn--print" onClick={() => { setShowQR(false); onPrint(); }}>
                <i className="pi pi-print" /> Print this QR
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
