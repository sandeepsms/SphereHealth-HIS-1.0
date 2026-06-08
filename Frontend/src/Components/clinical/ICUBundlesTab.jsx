/**
 * ICUBundlesTab.jsx — R7hr-157
 *
 * Inline display of "Bundles of Care — ICU" data on the Doctor + Nurse
 * patient panel. Pre-R7hr-157 the ICU tab was just a launcher card that
 * navigated to /icu-bundles. The user asked for the bundle data to surface
 * "achche se" (properly) right on the patient panel — so the next nurse /
 * doctor opening the panel can see at a glance:
 *
 *   • overall compliance % (latest shift)
 *   • per-bundle status pills (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP)
 *   • recent shift sheets — date · shift · status · author · overall %
 *
 * Read-only; clicking "Open full editor" jumps to /icu-bundles where the
 * full daily checklist (NABH HIC.5) is filled / finalised. Backed by
 * GET /api/icu-bundles/:uhid (30-day window, sorted newest-first).
 */

import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getList, BUNDLE_DEFS } from "../../Services/icuBundleService";

const C = {
  primary: "#0ea5e9", primaryL: "#e0f2fe", primaryD: "#0369a1",
  ok: "#15803d",     okL: "#dcfce7",
  warn: "#a16207",   warnL: "#fef3c7",
  bad: "#b91c1c",    badL: "#fee2e2",
  slate: "#475569",  slateL: "#f1f5f9",
  border: "#e2e8f0", card: "#ffffff", muted: "#64748b", dark: "#0f172a",
};

const SHIFT_LBL = { Morning: "🌅 Morning", Evening: "🌆 Evening", Night: "🌙 Night" };

function pctTone(pct) {
  const p = Number(pct) || 0;
  if (p >= 90) return { fg: C.ok,   bg: C.okL,   label: "Excellent" };
  if (p >= 70) return { fg: C.warn, bg: C.warnL, label: "Below target" };
  return        { fg: C.bad,  bg: C.badL,  label: "At risk" };
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(d); }
}
function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return String(d); }
}

export default function ICUBundlesTab({ uhid, role = "Nurse" }) {
  const navigate = useNavigate();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const load = useCallback(async () => {
    if (!uhid) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const res = await getList(uhid);
      const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setRows(list);
    } catch (e) {
      setError(e?.message || "Could not load ICU bundles");
    } finally { setLoading(false); }
  }, [uhid]);

  useEffect(() => { load(); }, [load]);

  const openEditor = () => navigate(`/icu-bundles?uhid=${encodeURIComponent(uhid || "")}`);

  // Latest sheet sits on top — list is already date desc, shift asc; that
  // matches the "newest first" expectation for the live patient panel.
  const latest = rows[0] || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header band */}
      <div style={{
        background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryD} 100%)`,
        borderRadius: 12, padding: "12px 16px", color: "#fff",
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        boxShadow: "0 4px 14px rgba(14,165,233,.22)",
      }}>
        <span style={{
          width: 36, height: 36, borderRadius: 10,
          background: "rgba(255,255,255,.18)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 18,
        }}>🛡</span>
        <div style={{ flex: "1 1 auto", minWidth: 200 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Bundles of Care — ICU</div>
          <div style={{ fontSize: 11, opacity: .9, marginTop: 1 }}>
            VAP · CAUTI · CLABSI · DVT · Sepsis · SUP — NABH HIC.5 quality bundles
          </div>
        </div>
        <button onClick={openEditor} style={{
          padding: "7px 14px",
          background: "rgba(255,255,255,.18)",
          border: "1px solid rgba(255,255,255,.35)",
          borderRadius: 8, color: "#fff", cursor: "pointer",
          fontFamily: "inherit", fontWeight: 700, fontSize: 12,
        }}>
          <i className="pi pi-pencil" style={{ marginRight: 5, fontSize: 10 }} />
          {role === "Nurse" ? "Fill / amend sheet" : "Open full editor"} ↗
        </button>
      </div>

      {/* Loading / error / empty */}
      {loading && (
        <div style={{ padding: 30, textAlign: "center", color: C.muted, fontSize: 12 }}>
          <i className="pi pi-spin pi-spinner" style={{ marginRight: 8 }} />Loading bundle sheets…
        </div>
      )}
      {!loading && error && (
        <div style={{
          padding: 14, background: C.badL, border: `1px solid ${C.bad}33`,
          borderRadius: 10, color: C.bad, fontSize: 12, fontWeight: 700,
        }}>
          <i className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />
          {error}
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div style={{
          padding: 30, textAlign: "center",
          background: C.slateL, border: `1px dashed ${C.border}`, borderRadius: 12,
        }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🛡</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.dark, marginBottom: 4 }}>
            No ICU bundle sheets filed yet
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
            Daily VAP / CAUTI / CLABSI / DVT / Sepsis / SUP compliance checklist (NABH HIC.5).<br/>
            The nurse fills the bundle each shift; the doctor signs off.
          </div>
          <button onClick={openEditor} style={{
            padding: "8px 16px", background: C.primary, color: "#fff", border: "none",
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
          }}>
            <i className="pi pi-plus" style={{ marginRight: 6 }} />Start today's sheet
          </button>
        </div>
      )}

      {/* Latest sheet — hero card */}
      {!loading && !error && latest && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 14,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 12,
            flexWrap: "wrap",
          }}>
            <span style={{
              fontSize: 10, fontWeight: 800, color: C.primary,
              background: C.primaryL, padding: "3px 9px", borderRadius: 999,
              textTransform: "uppercase", letterSpacing: ".4px",
            }}>
              Latest sheet
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.dark }}>
              {fmtDate(latest.date)}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>
              · {SHIFT_LBL[latest.shift] || latest.shift}
            </span>
            <span style={{
              marginLeft: "auto",
              fontSize: 10, fontWeight: 800,
              padding: "3px 10px", borderRadius: 999,
              background: latest.status === "Finalized" ? C.okL : C.warnL,
              color:      latest.status === "Finalized" ? C.ok  : C.warn,
              textTransform: "uppercase", letterSpacing: ".4px",
            }}>
              {latest.status === "Finalized" ? "✓ Finalised" : "✎ Draft"}
            </span>
            <span style={{
              fontSize: 14, fontWeight: 900, color: pctTone(latest.overallCompliancePct).fg,
              background: pctTone(latest.overallCompliancePct).bg,
              padding: "5px 12px", borderRadius: 8,
              fontFamily: "'DM Mono', monospace",
            }}>
              {Math.round(Number(latest.overallCompliancePct) || 0)}%
            </span>
          </div>

          {/* Per-bundle compliance grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}>
            {BUNDLE_DEFS.map(b => {
              const blk = latest.bundles?.[b.key] || {};
              const applicable = blk.applicable !== false;
              const pct = Number(blk.compliancePct) || 0;
              const tone = pctTone(pct);
              return (
                <div key={b.key} style={{
                  border: `1px solid ${applicable ? C.border : "#e5e7eb"}`,
                  background: applicable ? "#fff" : "#f8fafc",
                  borderRadius: 10, padding: "10px 12px",
                  display: "flex", flexDirection: "column", gap: 6,
                  opacity: applicable ? 1 : .55,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <i className={`pi ${b.icon}`} style={{ fontSize: 12, color: C.primary }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: C.dark, flex: 1 }}>
                      {b.title.split("—")[0].trim()}
                    </span>
                    {applicable ? (
                      <span style={{
                        fontSize: 10, fontWeight: 800,
                        background: tone.bg, color: tone.fg,
                        padding: "2px 8px", borderRadius: 999,
                        fontFamily: "'DM Mono', monospace",
                      }}>
                        {Math.round(pct)}%
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 9, fontWeight: 700,
                        background: C.slateL, color: C.slate,
                        padding: "2px 7px", borderRadius: 999,
                        textTransform: "uppercase", letterSpacing: ".3px",
                      }}>
                        Not applicable
                      </span>
                    )}
                  </div>
                  {/* progress bar — only when applicable */}
                  {applicable && (
                    <div style={{
                      height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%", width: `${Math.min(100, pct)}%`,
                        background: tone.fg, transition: "width .4s ease",
                      }} />
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.3 }}>
                    {b.subtitle}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer: who signed */}
          <div style={{
            marginTop: 12, paddingTop: 10,
            borderTop: `1px dashed ${C.border}`,
            display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
            fontSize: 11, color: C.muted,
          }}>
            <span>
              <strong style={{ color: C.dark }}>Last updated by:</strong> {latest.updatedBy || latest.finalizedBy || "—"}
            </span>
            {latest.finalizedAt && (
              <span>
                <strong style={{ color: C.dark }}>Finalised:</strong> {fmtDateTime(latest.finalizedAt)} by {latest.finalizedBy || "—"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Recent sheets list (excluding the latest one rendered above) */}
      {!loading && !error && rows.length > 1 && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 14px", background: C.slateL,
            borderBottom: `1px solid ${C.border}`,
            fontSize: 11, fontWeight: 800, color: C.slate,
            textTransform: "uppercase", letterSpacing: ".4px",
          }}>
            Recent sheets ({rows.length - 1} earlier, last 30 days)
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fcfdff", color: C.muted, fontSize: 10, textTransform: "uppercase" }}>
                <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, letterSpacing: ".3px" }}>Date</th>
                <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, letterSpacing: ".3px" }}>Shift</th>
                <th style={{ padding: "7px 12px", textAlign: "center", fontWeight: 700, letterSpacing: ".3px" }}>Status</th>
                <th style={{ padding: "7px 12px", textAlign: "center", fontWeight: 700, letterSpacing: ".3px" }}>Overall %</th>
                {BUNDLE_DEFS.map(b => (
                  <th key={b.key} style={{ padding: "7px 6px", textAlign: "center", fontWeight: 700, letterSpacing: ".3px", textTransform: "uppercase" }}>
                    {b.key}
                  </th>
                ))}
                <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, letterSpacing: ".3px" }}>Signed by</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(1, 30).map(r => {
                const ot = pctTone(r.overallCompliancePct);
                return (
                  <tr key={r._id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 12px", fontWeight: 700, color: C.dark, whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: "7px 12px", color: C.slate, whiteSpace: "nowrap" }}>{SHIFT_LBL[r.shift] || r.shift}</td>
                    <td style={{ padding: "7px 12px", textAlign: "center" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800,
                        padding: "2px 8px", borderRadius: 999,
                        background: r.status === "Finalized" ? C.okL : C.warnL,
                        color:      r.status === "Finalized" ? C.ok  : C.warn,
                        textTransform: "uppercase", letterSpacing: ".3px",
                      }}>
                        {r.status === "Finalized" ? "Final" : "Draft"}
                      </span>
                    </td>
                    <td style={{ padding: "7px 12px", textAlign: "center" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 800,
                        background: ot.bg, color: ot.fg,
                        padding: "3px 8px", borderRadius: 6,
                        fontFamily: "'DM Mono', monospace",
                      }}>
                        {Math.round(Number(r.overallCompliancePct) || 0)}%
                      </span>
                    </td>
                    {BUNDLE_DEFS.map(b => {
                      const blk = r.bundles?.[b.key] || {};
                      const applicable = blk.applicable !== false;
                      const pct = Number(blk.compliancePct) || 0;
                      const tone = pctTone(pct);
                      return (
                        <td key={b.key} style={{ padding: "7px 6px", textAlign: "center" }}>
                          {applicable ? (
                            <span style={{
                              fontSize: 10, fontWeight: 700,
                              background: tone.bg, color: tone.fg,
                              padding: "2px 6px", borderRadius: 4,
                              fontFamily: "'DM Mono', monospace",
                              display: "inline-block", minWidth: 32,
                            }}>
                              {Math.round(pct)}%
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: C.muted }}>n/a</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ padding: "7px 12px", color: C.muted, fontSize: 11 }}>
                      {r.finalizedBy || r.updatedBy || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
