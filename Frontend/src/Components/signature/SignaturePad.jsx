/**
 * SignaturePad.jsx
 * Canvas-based digital signature capture.
 *
 * Props:
 *   onSave   : (dataUrl: string) => void  — called with base64 PNG
 *   onCancel : () => void
 *   existing : string | null              — current signature data URL (for preview)
 *   userName : string                     — shown in header
 */
import React, { useRef, useState, useEffect, useCallback } from "react";

const C = {
  primary: "#4338ca", primaryL: "#eef2ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  border: "#e2e8f0", muted: "#64748b", text: "#0f172a",
  card: "#ffffff",
};

export default function SignaturePad({ onSave, onCancel, existing, userName }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [tab, setTab] = useState("draw"); // "draw" | "upload"
  const [uploadPreview, setUploadPreview] = useState(null);
  const lastPos = useRef({ x: 0, y: 0 });

  /* ── Canvas setup ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Fill white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw guide line
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 40);
    ctx.lineTo(canvas.width - 20, canvas.height - 40);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.2;
  }, [tab]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getPos(e, canvas);
    lastPos.current = pos;
    setDrawing(true);
    setIsEmpty(false);

    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#1e293b";
    ctx.fill();
  }, []);

  const draw = useCallback((e) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getPos(e, canvas);
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  }, [drawing]);

  const endDraw = useCallback(() => { setDrawing(false); }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 40);
    ctx.lineTo(canvas.width - 20, canvas.height - 40);
    ctx.stroke();
    ctx.setLineDash([]);
    setIsEmpty(true);
  };

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setUploadPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (tab === "upload") {
      if (uploadPreview) onSave(uploadPreview);
      return;
    }
    if (isEmpty) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL("image/png"));
  };

  const canSave = tab === "draw" ? !isEmpty : !!uploadPreview;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(15,23,42,.7)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: C.card, borderRadius: 18, width: "min(560px, 96vw)",
        boxShadow: "0 24px 64px rgba(0,0,0,.35)", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#3730a3,#4338ca)",
          padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>
              <i className="pi pi-pen-to-square" style={{ marginRight: 8 }} />
              Digital Signature Setup
            </div>
            <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, marginTop: 2 }}>
              {userName ? `${userName} — ` : ""}Draw once, auto-applied to all documents
            </div>
          </div>
          <button onClick={onCancel} style={{
            background: "rgba(255,255,255,.15)", border: "none", borderRadius: 8,
            color: "#fff", width: 32, height: 32, cursor: "pointer", fontSize: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
          {["draw", "upload"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "10px 0", border: "none", background: "none",
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              color: tab === t ? C.primary : C.muted,
              borderBottom: tab === t ? `2.5px solid ${C.primary}` : "2.5px solid transparent",
            }}>
              <i className={`pi ${t === "draw" ? "pi-pencil" : "pi-upload"}`} style={{ marginRight: 6 }} />
              {t === "draw" ? "Draw Signature" : "Upload Image"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: "20px 24px" }}>
          {tab === "draw" ? (
            <>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                Sign with mouse or touchscreen in the box below:
              </div>
              <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: `1.5px solid ${C.border}` }}>
                <canvas
                  ref={canvasRef}
                  width={480}
                  height={180}
                  style={{ display: "block", width: "100%", cursor: "crosshair", touchAction: "none" }}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={endDraw}
                />
                {isEmpty && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", pointerEvents: "none",
                  }}>
                    <span style={{ color: "#cbd5e1", fontSize: 13 }}>Sign here ↗</span>
                  </div>
                )}
              </div>
              <button onClick={clearCanvas} style={{
                marginTop: 8, background: "none", border: "none", color: C.red,
                fontSize: 12, cursor: "pointer", padding: "4px 0", fontWeight: 600,
              }}>
                <i className="pi pi-refresh" style={{ marginRight: 4 }} /> Clear
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                Upload a signature image (PNG / JPG, transparent background preferred):
              </div>
              <label style={{
                display: "block", border: `2px dashed ${C.border}`, borderRadius: 10,
                padding: 24, textAlign: "center", cursor: "pointer",
                background: uploadPreview ? "#f0fdf4" : "#f8fafc",
              }}>
                {uploadPreview ? (
                  <img src={uploadPreview} alt="signature preview"
                    style={{ maxHeight: 100, maxWidth: "100%", objectFit: "contain" }} />
                ) : (
                  <div>
                    <i className="pi pi-upload" style={{ fontSize: 28, color: C.muted, marginBottom: 8 }} />
                    <div style={{ fontSize: 13, color: C.muted }}>Click to upload signature image</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>PNG, JPG up to 2MB</div>
                  </div>
                )}
                <input type="file" accept="image/*" onChange={handleUpload} style={{ display: "none" }} />
              </label>
              {uploadPreview && (
                <button onClick={() => setUploadPreview(null)} style={{
                  marginTop: 8, background: "none", border: "none", color: C.red,
                  fontSize: 12, cursor: "pointer", padding: "4px 0", fontWeight: 600,
                }}>
                  <i className="pi pi-times" style={{ marginRight: 4 }} /> Remove
                </button>
              )}
            </>
          )}

          {/* Existing preview */}
          {existing && (
            <div style={{ marginTop: 12, padding: 12, background: C.greenL, borderRadius: 8, border: `1px solid #bbf7d0` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>
                <i className="pi pi-check-circle" style={{ marginRight: 4 }} />
                Current saved signature:
              </div>
              <img src={existing} alt="current signature"
                style={{ maxHeight: 50, maxWidth: "100%", objectFit: "contain" }} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{
          padding: "14px 24px", borderTop: `1px solid ${C.border}`, background: "#f8fafc",
          display: "flex", gap: 10, justifyContent: "flex-end",
        }}>
          <button onClick={onCancel} style={{
            padding: "9px 20px", background: "white", border: `1.5px solid ${C.border}`,
            borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, color: C.muted,
          }}>Cancel</button>
          <button onClick={handleSave} disabled={!canSave} style={{
            padding: "9px 20px",
            background: canSave ? "linear-gradient(135deg,#3730a3,#4338ca)" : "#cbd5e1",
            border: "none", borderRadius: 8, cursor: canSave ? "pointer" : "not-allowed",
            fontWeight: 700, fontSize: 13, color: "#fff",
          }}>
            <i className="pi pi-save" style={{ marginRight: 6 }} />
            Save Signature
          </button>
        </div>
      </div>
    </div>
  );
}
