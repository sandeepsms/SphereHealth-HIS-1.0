/**
 * InsurerFormsPage.jsx — R7hr(CLAIM-P4.3)
 * Admin management of the hospital's OFFICIAL insurer claim-form PDFs.
 *
 * The system fills the insurer's OWN form by overlaying claim data onto the
 * insurer's official blank PDF. This page is where the hospital uploads each
 * insurer's blank form once (their TPA desk has these) and maps where each
 * value lands. Fillable (AcroForm) PDFs auto-map by field name on upload; the
 * map stays editable. Insurers with no uploaded form fall back to the
 * generated standard-format claim form (still branded + auto-filled).
 */
import React, { useState, useEffect, useCallback, Suspense } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";

// R7hr(CLAIM-P5) — visual click-to-place mapper for flat PDFs. Lazy so
// pdfjs-dist (~1MB) loads only when a map editor actually opens it.
const PdfCoordinateMapper = React.lazy(() => import("./PdfCoordinateMapper"));

const C = { ink: "#0f172a", muted: "#64748b", line: "#e2e8f0", teal: "#0e7490", green: "#166534", red: "#dc2626", amber: "#b45309" };
const TYPE_ORDER = ["STANDALONE_HEALTH", "PRIVATE_GENERAL", "PSU", "DIGITAL"];

const Th = ({ children, right }) => <th style={{ textAlign: right ? "right" : "left", padding: "7px 10px", fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", borderBottom: `1px solid ${C.line}` }}>{children}</th>;
const Td = ({ children, right, tone }) => <td style={{ textAlign: right ? "right" : "left", padding: "7px 10px", fontSize: 12.5, color: tone || C.ink, borderBottom: `1px solid #f1f5f9` }}>{children}</td>;
const Btn = ({ children, onClick, tone = C.teal, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{ padding: "5px 10px", borderRadius: 7, border: "none", background: disabled ? "#cbd5e1" : tone, color: "#fff", cursor: disabled ? "default" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11 }}>{children}</button>
);

export default function InsurerFormsPage() {
  const [insurers, setInsurers] = useState([]);
  const [templates, setTemplates] = useState([]);   // active templates on file
  const [fields, setFields] = useState([]);          // mappable system fields
  const [loading, setLoading] = useState(true);
  const [mapFor, setMapFor] = useState(null);        // template being map-edited
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ins, tpl, fld] = await Promise.all([
        axios.get(`${API_ENDPOINTS.BASE}/insurers`).then((r) => r.data?.data || []).catch(() => []),
        axios.get(`${API_ENDPOINTS.BASE}/insurer-forms`).then((r) => r.data?.data || []).catch(() => []),
        axios.get(`${API_ENDPOINTS.BASE}/insurer-forms/mappable-fields`).then((r) => r.data?.data || []).catch(() => []),
      ]);
      setInsurers(ins); setTemplates(tpl); setFields(fld);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const tplFor = (code) => templates.find((t) => t.insurerCode === code && t.formType === "CLAIM");

  const upload = async (code, file) => {
    if (!file) return;
    setBusy(code);
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const r = await axios.post(`${API_ENDPOINTS.BASE}/insurer-forms/${code}/template`, fd);
      const d = r.data?.data;
      toast.success(d?.hasAcroForm ? `Uploaded — ${d.acroFields?.length || 0} fillable fields detected & auto-mapped` : "Uploaded (flat PDF — set coordinates in the map editor)");
      await load();
    } catch (e) { toast.error(e?.response?.data?.message || "Upload failed"); }
    finally { setBusy(""); }
  };

  const preview = async (code) => {
    try {
      const r = await axios.get(`${API_ENDPOINTS.BASE}/insurer-forms/${code}/blank`, { responseType: "blob" });
      window.open(URL.createObjectURL(new Blob([r.data], { type: "application/pdf" })), "_blank");
    } catch { toast.error("No blank on file"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Remove this uploaded form? Claims will fall back to the generated standard form.")) return;
    try { await axios.delete(`${API_ENDPOINTS.BASE}/insurer-forms/${id}`); toast.success("Removed"); await load(); }
    catch (e) { toast.error(e?.response?.data?.message || "Remove failed"); }
  };

  // R7hr(CLAIM-P5 follow-up): rows outside the 4 TYPE_ORDER groups were
  // silently filtered OUT. Two sources land there: (a) any registry
  // insurer with an unlisted type, and (b) ORPHAN templates — a blank
  // uploaded for a code the registry list doesn't return (e.g. the OTHER
  // fallback) existed in the backend but had no row here, so it could
  // never be re-mapped, previewed or removed from the UI.
  const listedCodes = new Set(insurers.map((i) => i.code));
  const orphanTemplates = templates
    .filter((t) => !listedCodes.has(t.insurerCode))
    .map((t) => ({ code: t.insurerCode, name: t.insurerName || t.insurerCode, type: "_REST" }));
  const grouped = [
    ...TYPE_ORDER.map((t) => ({ type: t, items: insurers.filter((i) => i.type === t) })),
    { type: "_REST", items: [...insurers.filter((i) => !TYPE_ORDER.includes(i.type)), ...orphanTemplates] },
  ].filter((g) => g.items.length);
  const onFile = tplFor;

  return (
    <div style={{ maxWidth: 1050, margin: "0 auto", padding: 16, fontFamily: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.ink }}>📄 Insurer Claim Forms</div>
          <div style={{ fontSize: 12, color: C.muted }}>Upload each insurer's official blank PDF once — the system overlays claim data onto it. No upload = generated standard form.</div>
        </div>
        <button onClick={load} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12 }}>↻ Refresh</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
        {templates.length} of {insurers.length} insurers have an official form on file.
      </div>

      {loading ? <div style={{ color: C.muted }}>Loading…</div> : grouped.map((g) => (
        <div key={g.type} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>{g.type === "_REST" ? "Other / Unlisted" : g.items[0]?.typeLabel}</div>
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><Th>Insurer</Th><Th>Official Form</Th><Th right>Actions</Th></tr></thead>
              <tbody>
                {g.items.map((ins) => {
                  const t = onFile(ins.code);
                  return (
                    <tr key={ins.code}>
                      <Td><strong>{ins.name}</strong> <span style={{ color: C.muted, fontSize: 11 }}>{ins.code}</span></Td>
                      <Td>
                        {t ? (
                          <span style={{ color: C.green, fontWeight: 700 }}>
                            ● {t.fileName || "on file"} <span style={{ color: C.muted, fontWeight: 400 }}>v{t.version} · {t.hasAcroForm ? `${t.acroFields?.length || 0} fillable` : "flat"} · {(t.fieldMap || []).length} mapped</span>
                          </span>
                        ) : <span style={{ color: C.amber }}>○ generated standard form</span>}
                      </Td>
                      <Td right>
                        <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                          <label style={{ padding: "5px 10px", borderRadius: 7, background: busy === ins.code ? "#cbd5e1" : C.teal, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 11 }}>
                            {busy === ins.code ? "…" : (t ? "Replace" : "Upload")}
                            <input type="file" accept="application/pdf,.pdf" style={{ display: "none" }} disabled={busy === ins.code}
                              onChange={(e) => { upload(ins.code, e.target.files?.[0]); e.target.value = ""; }} />
                          </label>
                          {t && <Btn tone="#475569" onClick={() => preview(ins.code)}>Preview</Btn>}
                          {t && <Btn tone="#334155" onClick={() => setMapFor(t)}>Map</Btn>}
                          {t && <Btn tone={C.red} onClick={() => remove(t._id)}>Remove</Btn>}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {mapFor && <MapEditor tpl={mapFor} fields={fields} onClose={() => setMapFor(null)} onSaved={async () => { setMapFor(null); await load(); }} />}
    </div>
  );
}

// ── field-map editor ────────────────────────────────────────────────────
function MapEditor({ tpl, fields, onClose, onSaved }) {
  const [rows, setRows] = useState(() => (tpl.fieldMap || []).map((m) => ({ ...m })));
  const [saving, setSaving] = useState(false);
  const acro = tpl.acroFields || [];
  const isFillable = tpl.hasAcroForm;
  // R7hr(CLAIM-P5): visual mapper auto-opens for flat PDFs (they used to
  // get only blind numeric x/y inputs); fillable PDFs can open it too —
  // an x/y row acts as the overlay engine's fallback when acroName fails.
  const [showMapper, setShowMapper] = useState(!isFillable);

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const addRow = () => setRows((rs) => [...rs, isFillable ? { field: "", acroName: acro[0] || "" } : { field: "", page: 0, x: 100, y: 700, size: 9 }]);
  const delRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  // Click-to-place from the visual mapper: one coordinate row per field —
  // update in place if the field is already mapped, else append.
  const placeField = useCallback(({ field, page, x, y }) => {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.field === field);
      if (i >= 0) return rs.map((r, j) => j === i ? { ...r, page, x, y, size: r.size || 9 } : r);
      return [...rs, { field, page, x, y, size: 9 }];
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      // R7hr(CLAIM-P5): numeric inputs yield STRING x/y — the old
      // `typeof r.x === "number"` filter silently dropped hand-edited
      // coordinate rows on save. Accept anything that parses to a number.
      const hasXY = (r) => r.x !== "" && r.x != null && !isNaN(Number(r.x))
                        && r.y !== "" && r.y != null && !isNaN(Number(r.y));
      const clean = rows.filter((r) => r.field && (r.acroName || hasXY(r)))
        .map((r) => ({ field: r.field, acroName: r.acroName || undefined, page: Number(r.page) || 0, x: hasXY(r) ? Number(r.x) : undefined, y: hasXY(r) ? Number(r.y) : undefined, size: Number(r.size) || 9 }));
      await axios.put(`${API_ENDPOINTS.BASE}/insurer-forms/${tpl._id}/field-map`, { fieldMap: clean });
      toast.success(`Saved ${clean.length} field mappings`);
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 18, width: "min(1000px, 96vw)", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, flex: 1 }}>Field Map — {tpl.insurerName} <span style={{ color: C.muted, fontSize: 12 }}>({tpl.fileName})</span></div>
          <Btn tone={showMapper ? "#475569" : C.teal} onClick={() => setShowMapper((s) => !s)}>
            {showMapper ? "Hide visual mapper" : "🎯 Visual mapper"}
          </Btn>
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, margin: "4px 0 12px" }}>
          {isFillable
            ? "Fillable PDF — map each system value to one of the form's field names."
            : "Flat PDF — pick a field and click on the form below where its value should print (or type x/y directly; points from bottom-left, A4 ≈ 595×842)."}
        </div>

        {showMapper && (
          <Suspense fallback={<div style={{ padding: 14, color: C.muted, fontSize: 12 }}>Loading PDF preview…</div>}>
            <PdfCoordinateMapper insurerCode={tpl.insurerCode} formType={tpl.formType} rows={rows} fields={fields} onPlace={placeField} />
          </Suspense>
        )}

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <Th>System Value</Th>
            {isFillable ? <Th>PDF Field</Th> : <><Th>Page</Th><Th>X</Th><Th>Y</Th><Th>Size</Th></>}
            <Th right></Th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <Td>
                  <select value={r.field} onChange={(e) => setRow(i, "field", e.target.value)} style={{ width: "100%", padding: 5, fontSize: 12 }}>
                    <option value="">— select —</option>
                    {fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                  </select>
                </Td>
                {isFillable ? (
                  <Td>
                    <select value={r.acroName || ""} onChange={(e) => setRow(i, "acroName", e.target.value)} style={{ width: "100%", padding: 5, fontSize: 12 }}>
                      <option value="">— select field —</option>
                      {acro.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </Td>
                ) : (
                  <>
                    <Td><input type="number" value={r.page ?? 0} onChange={(e) => setRow(i, "page", e.target.value)} style={{ width: 48, padding: 4 }} /></Td>
                    <Td><input type="number" value={r.x ?? ""} onChange={(e) => setRow(i, "x", e.target.value)} style={{ width: 60, padding: 4 }} /></Td>
                    <Td><input type="number" value={r.y ?? ""} onChange={(e) => setRow(i, "y", e.target.value)} style={{ width: 60, padding: 4 }} /></Td>
                    <Td><input type="number" value={r.size ?? 9} onChange={(e) => setRow(i, "size", e.target.value)} style={{ width: 44, padding: 4 }} /></Td>
                  </>
                )}
                <Td right><Btn tone={C.red} onClick={() => delRow(i)}>✕</Btn></Td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <Btn tone="#475569" onClick={addRow}>+ Add mapping</Btn>
          <span style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Cancel</button>
            <Btn tone={C.green} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Map"}</Btn>
          </span>
        </div>
      </div>
    </div>
  );
}
