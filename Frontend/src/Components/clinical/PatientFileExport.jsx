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

  /** Print just the referenced DOM area, not the whole SPA chrome. */
  const onPrint = useCallback(() => {
    const node = printRef?.current;
    if (!node) {
      window.print();
      return;
    }
    setBusy("print");
    try {
      // We add a body class that hides everything except .pfe-printable
      // for the duration of the print. Style lives in patient-file-print.css.
      document.body.classList.add("pfe-printing");
      node.classList.add("pfe-printable");
      // Slight defer so the class flushes to the layout
      setTimeout(() => {
        window.print();
        // Cleanup after print dialog closes (afterprint fires reliably on
        // modern browsers; we also add a safety timeout).
        const cleanup = () => {
          document.body.classList.remove("pfe-printing");
          node.classList.remove("pfe-printable");
          window.removeEventListener("afterprint", cleanup);
          setBusy("");
        };
        window.addEventListener("afterprint", cleanup);
        setTimeout(cleanup, 60_000); // safety
      }, 50);
    } catch (e) {
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
  const onShare = useCallback(() => setShowQR(true), []);

  /** Copy the share URL to clipboard. */
  const onCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied — share via WhatsApp / SMS");
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
                  <img src={qrSrc} alt={`QR for ${patient.fullName} (${patient.UHID})`} className="pfe-qr-img" />
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
