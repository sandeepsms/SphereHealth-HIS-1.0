/**
 * PatientDevicesStrip.jsx — R7hr-184
 *
 * Invasive-device registry strip for the shared patient banner
 * (PatientHeaderCard). Doctor OR Nurse records which devices the
 * patient currently has — Intubated (ET tube) / Tracheostomy /
 * Central line / PICC / Urinary catheter (Foley) / IV cannula /
 * Arterial line / NG tube / Chest tube — WHEN each was placed,
 * every CHANGE (re-site / article replacement) with its own
 * timestamp + actor, and removal.
 *
 * Downstream: ICU Bundles applicability is device-driven —
 * no ET tube → VAP N/A · no Foley → CAUTI N/A · no central line →
 * CLABSI N/A (ICUBundlesPage reads the same registry).
 *
 * Self-contained: fetches GET /patient-devices/ipd/:ipdNo, writes via
 * POST / + PATCH /:id/change + PATCH /:id/remove. Backend stamps the
 * JWT actor; UI never sends actor identity (R7gw-B1).
 */
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

const C = {
  teal: "#0d9488", tealL: "#ccfbf1", tealB: "#99f6e4",
  red: "#dc2626", redL: "#fef2f2",
  amber: "#b45309", amberL: "#fef3c7",
  slate: "#475569", slateL: "#f1f5f9",
  border: "#e2e8f0", muted: "#64748b", dark: "#0f172a",
  green: "#15803d", greenL: "#dcfce7",
};

// Mirror of backend DEVICE_TYPES (labels + ICU-bundle linkage).
const DEVICE_TYPES = {
  ET_TUBE:          { label: "Endotracheal Tube (Intubated)", icon: "🫁", bundle: "VAP" },
  TRACHEOSTOMY:     { label: "Tracheostomy",                  icon: "🗣️", bundle: "VAP" },
  CENTRAL_LINE:     { label: "Central Line (CVC)",            icon: "🩸", bundle: "CLABSI" },
  PICC_LINE:        { label: "PICC Line",                     icon: "🩸", bundle: "CLABSI" },
  URINARY_CATHETER: { label: "Urinary Catheter (Foley)",      icon: "🚿", bundle: "CAUTI" },
  IV_CANNULA:       { label: "Peripheral IV Cannula",         icon: "💉", bundle: null },
  ARTERIAL_LINE:    { label: "Arterial Line",                 icon: "🩺", bundle: null },
  NG_TUBE:          { label: "NG / Ryle's Tube",              icon: "👃", bundle: null },
  CHEST_TUBE:       { label: "Chest Tube / ICD",              icon: "📤", bundle: null },
  OTHER:            { label: "Other Device",                  icon: "🔧", bundle: null },
};

const CHANGE_REASONS = [
  "Routine re-site (72h policy)", "Blocked / not flushing", "Phlebitis at site",
  "Dislodged / pulled out", "Leaking / soiled", "Size change required", "Other",
];

const fmtDT = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const fld = { width: "100%", padding: "7px 9px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontFamily: "'DM Sans', sans-serif", fontSize: 12, outline: "none", boxSizing: "border-box" };
const lbl = { fontSize: 9.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 3 };

// R7hr-185b — `inline` renders the FULL manage view (place form + complete
// placed/changed/removed history) directly in the page flow — used by the
// patient panels' "🔌 Devices / Lines" tab. Default (chips + modal) stays
// for the Doctor/Nursing Notes banner strip.
export default function PatientDevicesStrip({ ipdNo, inline = false }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  // Add-device form
  const [nType, setNType] = useState("");
  const [nSite, setNSite] = useState("");
  const [nSize, setNSize] = useState("");
  const [nLabel, setNLabel] = useState("");
  // Per-row inline change form: { [id]: { reason, site, size, note } }
  const [chg, setChg] = useState({});

  const load = useCallback(async () => {
    if (!ipdNo || ipdNo === "—") return;
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BASE}/patient-devices/ipd/${encodeURIComponent(ipdNo)}`);
      setRows(Array.isArray(data?.data) ? data.data : []);
      setDenied(false);
    } catch (e) {
      // 403 = role can't read MAR-scope data; hide the strip silently.
      if (e?.response?.status === 403) setDenied(true);
    }
  }, [ipdNo]);

  useEffect(() => { load(); }, [load]);

  if (!ipdNo || ipdNo === "—" || denied) return null;

  const active = rows.filter(r => r.status === "Active");

  const placeDevice = async () => {
    if (!nType) return;
    setBusy(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/patient-devices`, {
        ipdNo, deviceType: nType,
        site: nSite, size: nSize,
        deviceLabel: nType === "OTHER" ? nLabel : undefined,
      });
      setNType(""); setNSite(""); setNSize(""); setNLabel("");
      await load();
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Could not save device");
    } finally { setBusy(false); }
  };

  const logChange = async (id) => {
    const f = chg[id] || {};
    if (!f.reason) { alert("Pick a reason for the change"); return; }
    setBusy(true);
    try {
      await axios.patch(`${API_ENDPOINTS.BASE}/patient-devices/${id}/change`, f);
      setChg(p => { const n = { ...p }; delete n[id]; return n; });
      await load();
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Could not log change");
    } finally { setBusy(false); }
  };

  const removeDevice = async (id, labelTx) => {
    const reason = window.prompt(`Remove ${labelTx}?\nReason for removal (e.g. "No longer required", "Extubated", "Catheter out"):`);
    if (reason === null) return;
    setBusy(true);
    try {
      await axios.patch(`${API_ENDPOINTS.BASE}/patient-devices/${id}/remove`, { reason });
      await load();
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Could not remove device");
    } finally { setBusy(false); }
  };

  const meta = (t) => DEVICE_TYPES[t] || DEVICE_TYPES.OTHER;

  return (
    <>
      {/* ── Chip strip (lives inside the banner, under the clinical strip;
            hidden in `inline` tab mode where the full view is always open) ── */}
      {!inline && (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8 }}>
        <button
          onClick={() => setOpen(true)}
          title="Record intubation / catheter / cannula / lines — placed, changed, removed"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 11px", borderRadius: 999,
            border: `1.5px dashed ${C.teal}`, background: "#fff",
            color: C.teal, fontFamily: "'DM Sans', sans-serif",
            fontSize: 11, fontWeight: 800, cursor: "pointer",
          }}>
          <i className="pi pi-plus-circle" style={{ fontSize: 11 }} />
          Devices / Lines
          <span style={{ background: active.length ? C.tealL : C.slateL, color: active.length ? C.teal : C.muted, borderRadius: 6, padding: "0 6px", fontSize: 9.5, fontWeight: 800, fontFamily: "'DM Mono', monospace" }}>
            {active.length}
          </span>
        </button>
        {active.map(d => {
          const m = meta(d.deviceType);
          const lastChange = d.changes?.length ? d.changes[d.changes.length - 1] : null;
          return (
            <span key={d._id}
              title={`${m.label}${d.site ? ` · ${d.site}` : ""}\nPlaced: ${fmtDT(d.placedAt)} by ${d.placedBy?.name || "—"}${lastChange ? `\nLast changed: ${fmtDT(lastChange.changedAt)} (${lastChange.reason || "—"})` : ""}${m.bundle ? `\nICU bundle: ${m.bundle} applicable` : ""}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 999,
                background: C.tealL, border: `1px solid ${C.tealB}`,
                fontSize: 11, fontWeight: 700, color: "#115e59",
              }}>
              <span>{m.icon}</span>
              {d.deviceLabel || m.label}
              {d.size ? <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{d.size}</span> : null}
              <span style={{ fontSize: 9.5, color: "#0f766e", fontWeight: 600 }}>
                since {fmtDT(d.placedAt)}
              </span>
              {d.changes?.length > 0 && (
                <span style={{ background: C.amberL, color: C.amber, borderRadius: 6, padding: "0 5px", fontSize: 9, fontWeight: 800 }}>
                  ↻ {d.changes.length}×
                </span>
              )}
            </span>
          );
        })}
      </div>
      )}

      {/* ── Manage view — modal overlay by default; rendered directly in
            the page flow when `inline` (patient-panel Devices tab). ── */}
      {(open || inline) && (
        <div onClick={(e) => { if (!inline && e.target === e.currentTarget) setOpen(false); }}
          style={inline
            ? {}
            : { position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={inline
            ? { width: "100%", background: "#fff", borderRadius: 14, overflow: "hidden", border: `1px solid ${C.border}`, fontFamily: "'DM Sans', system-ui, sans-serif" }
            : { width: "min(860px, 100%)", background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.25)", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
            {/* Header */}
            <div style={{ background: `linear-gradient(135deg, ${C.teal}, #0f766e)`, padding: "14px 18px", color: "#fff", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>🩺</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 900 }}>Invasive Devices & Lines — {ipdNo}</div>
                <div style={{ fontSize: 11, opacity: .92 }}>Placed / Changed / Removed — full timestamped trail · drives ICU bundle applicability (no ET tube → VAP N/A · no Foley → CAUTI N/A · no central line → CLABSI N/A)</div>
              </div>
              {!inline && (
                <button onClick={() => setOpen(false)} style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,.18)", border: "1px solid rgba(255,255,255,.35)", color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 800 }}>×</button>
              )}
            </div>

            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Add device */}
              <div style={{ background: "#f0fdfa", border: `1px solid ${C.tealB}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.teal, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>＋ Place a new device</div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1fr auto", gap: 8, alignItems: "end" }}>
                  <div>
                    <div style={lbl}>Device *</div>
                    <select style={fld} value={nType} onChange={e => setNType(e.target.value)}>
                      <option value="">— Select device —</option>
                      {Object.entries(DEVICE_TYPES).map(([k, v]) => (
                        <option key={k} value={k}>{v.icon} {v.label}{v.bundle ? ` → ${v.bundle}` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={lbl}>Site</div>
                    <input style={fld} value={nSite} placeholder="e.g. Right forearm / Right IJV" onChange={e => setNSite(e.target.value)} />
                  </div>
                  <div>
                    <div style={lbl}>Size</div>
                    <input style={fld} value={nSize} placeholder="18G / ET 7.5 / 16Fr" onChange={e => setNSize(e.target.value)} />
                  </div>
                  <button disabled={busy || !nType} onClick={placeDevice}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: nType ? C.teal : C.slateL, color: nType ? "#fff" : C.muted, fontWeight: 800, fontSize: 12, cursor: nType ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
                    {busy ? "…" : "Place"}
                  </button>
                </div>
                {nType === "OTHER" && (
                  <div style={{ marginTop: 8 }}>
                    <div style={lbl}>Device name</div>
                    <input style={fld} value={nLabel} placeholder="Name the device" onChange={e => setNLabel(e.target.value)} />
                  </div>
                )}
              </div>

              {/* Device list */}
              {rows.length === 0 && (
                <div style={{ textAlign: "center", color: C.muted, fontSize: 12, padding: 18 }}>
                  No devices recorded for this admission yet.
                </div>
              )}
              {rows.map(d => {
                const m = meta(d.deviceType);
                const isActive = d.status === "Active";
                const f = chg[d._id];
                return (
                  <div key={d._id} style={{ border: `1.5px solid ${isActive ? C.tealB : C.border}`, borderRadius: 10, overflow: "hidden", opacity: isActive ? 1 : .75 }}>
                    <div style={{ padding: "9px 12px", background: isActive ? "#f0fdfa" : C.slateL, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 15 }}>{m.icon}</span>
                      <span style={{ fontWeight: 800, fontSize: 13, color: C.dark }}>{d.deviceLabel || m.label}</span>
                      {d.size && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.slate }}>{d.size}</span>}
                      {d.site && <span style={{ fontSize: 11, color: C.muted }}>📍 {d.site}</span>}
                      {m.bundle && <span style={{ background: C.amberL, color: C.amber, borderRadius: 6, padding: "1px 7px", fontSize: 9.5, fontWeight: 800 }}>{m.bundle}</span>}
                      <span style={{ marginLeft: "auto", padding: "2px 9px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: isActive ? C.greenL : C.redL, color: isActive ? C.green : C.red }}>
                        {isActive ? "ACTIVE" : "REMOVED"}
                      </span>
                    </div>
                    <div style={{ padding: "8px 12px", fontSize: 11.5, color: C.slate, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div>🕐 <strong>Placed:</strong> {fmtDT(d.placedAt)} — {d.placedBy?.name || "—"}{d.placedBy?.employeeId ? ` (${d.placedBy.employeeId})` : ""}{d.placedBy?.role ? ` · ${d.placedBy.role}` : ""}</div>
                      {(d.changes || []).map((c, i) => (
                        <div key={i} style={{ color: C.amber }}>
                          ↻ <strong>Changed:</strong> {fmtDT(c.changedAt)} — {c.reason || "—"}{c.site ? ` · new site ${c.site}` : ""}{c.size ? ` · ${c.size}` : ""} — {c.changedBy?.name || "—"}
                        </div>
                      ))}
                      {!isActive && (
                        <div style={{ color: C.red }}>
                          ✕ <strong>Removed:</strong> {fmtDT(d.removedAt)} — {d.removalReason || "—"} — {d.removedBy?.name || "—"}
                        </div>
                      )}
                      {isActive && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                          {!f ? (
                            <>
                              <button onClick={() => setChg(p => ({ ...p, [d._id]: { reason: "", site: "", size: "", note: "" } }))}
                                style={{ padding: "5px 12px", borderRadius: 7, border: `1.5px solid ${C.amber}`, background: "#fff", color: C.amber, fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                                ↻ Log Change / Re-site
                              </button>
                              <button disabled={busy} onClick={() => removeDevice(d._id, d.deviceLabel || m.label)}
                                style={{ padding: "5px 12px", borderRadius: 7, border: `1.5px solid ${C.red}`, background: "#fff", color: C.red, fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                                ✕ Remove Device
                              </button>
                            </>
                          ) : (
                            <div style={{ width: "100%", background: C.amberL, border: `1px solid ${C.amber}40`, borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: 8 }}>
                                <div>
                                  <div style={lbl}>Reason *</div>
                                  <select style={fld} value={f.reason} onChange={e => setChg(p => ({ ...p, [d._id]: { ...f, reason: e.target.value } }))}>
                                    <option value="">— Why changed —</option>
                                    {CHANGE_REASONS.map(r => <option key={r}>{r}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <div style={lbl}>New site</div>
                                  <input style={fld} value={f.site} placeholder="(if re-sited)" onChange={e => setChg(p => ({ ...p, [d._id]: { ...f, site: e.target.value } }))} />
                                </div>
                                <div>
                                  <div style={lbl}>New size</div>
                                  <input style={fld} value={f.size} placeholder="(if changed)" onChange={e => setChg(p => ({ ...p, [d._id]: { ...f, size: e.target.value } }))} />
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                <button disabled={busy} onClick={() => logChange(d._id)}
                                  style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: C.amber, color: "#fff", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                                  Save Change
                                </button>
                                <button onClick={() => setChg(p => { const n = { ...p }; delete n[d._id]; return n; })}
                                  style={{ padding: "6px 14px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
