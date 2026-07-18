/**
 * PdfCoordinateMapper.jsx — R7hr(CLAIM-P5)
 * Visual field-mapper for FLAT (non-AcroForm) insurer claim PDFs.
 *
 * Renders the uploaded blank PDF page-by-page on a canvas (pdfjs-dist,
 * lazy-loaded so the ~1MB lib never rides the main bundle), and lets the
 * admin pick a system field and CLICK where its value should print.
 * Coordinates are converted to PDF points (bottom-left origin, click point
 * = text baseline — exactly what the backend overlay engine's
 * pg.drawText({x,y}) expects), then upserted into the SAME rows state the
 * numeric table edits, so the two editors stay in lock-step and the
 * existing PUT /insurer-forms/:id/field-map save path is unchanged.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

// Module-level singleton — pdfjs + its worker load once per session.
let _pdfjsPromise = null;
function loadPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const lib = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
  }
  return _pdfjsPromise;
}

const CANVAS_WIDTH = 620;   // px — fits the widened MapEditor modal

export default function PdfCoordinateMapper({ insurerCode, formType = "CLAIM", rows, fields, onPlace }) {
  const [pdf, setPdf] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [viewport, setViewport] = useState(null);
  const [activeField, setActiveField] = useState(fields[0]?.field || "");
  const [error, setError] = useState("");
  const canvasRef = useRef(null);
  // Serialises page renders — pdfjs throws on overlapping render() calls
  // to the same canvas when the admin flips pages quickly.
  const renderTaskRef = useRef(null);

  // Load the blank PDF once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lib, resp] = await Promise.all([
          loadPdfjs(),
          axios.get(`${API_ENDPOINTS.BASE}/insurer-forms/${insurerCode}/blank`, {
            params: { formType }, responseType: "arraybuffer",
          }),
        ]);
        // useSystemFonts: insurer blanks often use non-embedded standard
        // fonts (Helvetica etc.); without this pdfjs demands a bundled
        // standardFontDataUrl and the render stalls. For a coordinate-
        // mapper preview, local-font substitution is exactly right.
        const doc = await lib.getDocument({ data: resp.data, useSystemFonts: true }).promise;
        if (cancelled) { doc.destroy(); return; }
        setPdf(doc);
        setPageCount(doc.numPages);
      } catch (e) {
        if (!cancelled) setError(e?.response?.status === 404 ? "No blank PDF on file" : "Could not load the PDF preview");
      }
    })();
    return () => { cancelled = true; };
  }, [insurerCode, formType]);

  // Render the current page.
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: CANVAS_WIDTH / base.width });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        if (renderTaskRef.current) renderTaskRef.current.cancel();
        const task = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) setViewport(vp);
      } catch (e) {
        if (e?.name !== "RenderingCancelledException" && !cancelled) setError("Page render failed");
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNum]);

  const handleClick = useCallback((e) => {
    if (!viewport || !activeField) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // Canvas backing store == CSS pixels (widths set equal above), so the
    // click maps 1:1; convertToPdfPoint flips to bottom-left PDF points.
    const [px, py] = viewport.convertToPdfPoint(cx, cy);
    onPlace({ field: activeField, page: pageNum - 1, x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10 });
  }, [viewport, activeField, pageNum, onPlace]);

  const labelOf = (f) => fields.find((x) => x.field === f)?.label || f;
  // Markers for rows placed on THIS page (0-based in the map, 1-based
  // here). x/y may be strings when typed into the numeric table — parse.
  const numeric = (v) => v !== "" && v != null && !isNaN(Number(v));
  const markers = viewport
    ? rows
        .filter((r) => r.field && numeric(r.x) && numeric(r.y) && (Number(r.page) || 0) === pageNum - 1)
        .map((r) => {
          const [vx, vy] = viewport.convertToViewportPoint(Number(r.x), Number(r.y));
          return { ...r, vx, vy };
        })
    : [];

  if (error) return <div style={{ padding: 14, color: "#b45309", fontSize: 12.5 }}>⚠ {error}</div>;

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, marginBottom: 12, background: "#f8fafc" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: "#475569" }}>Place field:</label>
        <select value={activeField} onChange={(e) => setActiveField(e.target.value)} style={{ padding: 5, fontSize: 12, minWidth: 220 }}>
          {fields.map((f) => {
            const placed = rows.some((r) => r.field === f.field && r.x !== "" && r.x != null && !isNaN(Number(r.x)));
            return <option key={f.field} value={f.field}>{placed ? "● " : "○ "}{f.label}</option>;
          })}
        </select>
        <span style={{ fontSize: 11.5, color: "#64748b" }}>→ click on the form where this value should print</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => setPageNum((p) => Math.max(1, p - 1))} disabled={pageNum <= 1}
            style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: pageNum <= 1 ? "default" : "pointer", fontSize: 12 }}>‹</button>
          <span style={{ fontSize: 11.5, color: "#475569", fontWeight: 700 }}>Page {pageNum} / {pageCount}</span>
          <button onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))} disabled={pageNum >= pageCount}
            style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: pageNum >= pageCount ? "default" : "pointer", fontSize: 12 }}>›</button>
        </span>
      </div>

      <div style={{ position: "relative", display: "inline-block", lineHeight: 0, maxHeight: "52vh", overflow: "auto", border: "1px solid #cbd5e1", borderRadius: 6 }}>
        {!pdf && <div style={{ width: CANVAS_WIDTH, height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 12 }}>Loading PDF…</div>}
        <canvas ref={canvasRef} onClick={handleClick} style={{ cursor: "crosshair", display: pdf ? "block" : "none" }} />
        {markers.map((m, i) => (
          <div key={`${m.field}-${i}`}
            onClick={(e) => { e.stopPropagation(); setActiveField(m.field); }}
            title={`${labelOf(m.field)} — click to re-place`}
            style={{
              position: "absolute", left: m.vx, top: m.vy, transform: "translate(0, -100%)",
              background: m.field === activeField ? "#0e7490" : "rgba(14,116,144,.72)",
              color: "#fff", fontSize: 9.5, fontWeight: 700, padding: "1px 5px",
              borderRadius: 4, borderBottomLeftRadius: 0, cursor: "pointer",
              lineHeight: "13px", whiteSpace: "nowrap", pointerEvents: "auto",
              boxShadow: "0 1px 3px rgba(0,0,0,.3)",
            }}>
            {labelOf(m.field)}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6 }}>
        Chip ka bottom-left corner = text baseline. Galat jagah lagi ho to field select karke dobara click karo; fine-tune niche numeric table se.
      </div>
    </div>
  );
}
