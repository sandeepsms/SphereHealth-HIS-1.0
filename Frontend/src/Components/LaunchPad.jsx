/**
 * LaunchPad.jsx — R7hr-307 (USER), compacted R7hr-308
 * App-launcher navigation replacing the sidebar. Floating button (or
 * Alt+Space) opens a full-screen, searchable grid of every role-reachable
 * page as COMPACT tiles — sized to fit a single screen (no scroll). Each
 * tile carries its section's colour accent (sorted by section) so grouping
 * reads from colour without eating header rows. Click → navigate; Esc /
 * backdrop closes. Reuses the role-based NAV from Sidebar.
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useHospitalSettings } from "../context/HospitalSettingsContext";
import { NAV, filterNav, ROLE_META } from "./Sidebar";
import "primeicons/primeicons.css";

const badgeColor = (b) =>
  b === "LIVE" ? "#dc2626" : b === "NEW" ? "#d97706" : b === "NABH" ? "#7c3aed" :
  b === "ALL-IN-ONE" ? "#0891b2" : b === "COUNTER" ? "#d97706" : "#64748b";

export default function LaunchPad() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { settings } = useHospitalSettings();
  const userRole = user?.role || "Admin";
  const visibleNav = useMemo(() => filterNav(NAV, userRole), [userRole]);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && (e.code === "Space" || e.key === " ")) { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => searchRef.current?.focus(), 70); else setQ(""); }, [open]);

  const isActive = (path) => {
    if (!path) return false;
    const [p] = path.split("?");
    return location.pathname === p || location.pathname.startsWith(p + "/");
  };

  // Flat, section-sorted tile list (colour = grouping).
  const tiles = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const hit = (s) => !ql || (s || "").toLowerCase().includes(ql);
    const out = [];
    visibleNav.forEach((s) => {
      if (s.single || !s.items?.length) {
        if (hit(s.label) || hit(s.id)) out.push({ label: s.label, icon: s.icon, path: s.path, badge: s.badge, color: s.color, group: s.label });
      } else {
        s.items.forEach((it) => { if (hit(it.label) || hit(s.label)) out.push({ ...it, color: s.color, group: s.label }); });
      }
    });
    return out;
  }, [visibleNav, q]);

  const go = (path) => { if (path) navigate(path); setOpen(false); };
  const hospital = settings?.hospitalName || "Hospital";

  return (
    <>
      {/* ── Floating launcher trigger (bottom-left) ── */}
      <button
        onClick={() => setOpen(true)}
        title="Open menu — Alt+Space"
        aria-label="Open menu"
        style={{
          position: "fixed", left: 18, bottom: 18, zIndex: 1500,
          width: 52, height: 52, borderRadius: 15, border: "1px solid rgba(255,255,255,.18)",
          background: "linear-gradient(135deg, #4f46e5, #4338ca 55%, #7c3aed)",
          color: "#fff", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 10px 28px rgba(67,56,202,.45), inset 0 1px 0 rgba(255,255,255,.25)",
          transition: "transform .14s, box-shadow .18s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px) scale(1.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
      >
        <i className="pi pi-th-large" style={{ fontSize: 21 }} />
      </button>

      {/* ── Launchpad overlay (single screen, no scroll) ── */}
      {open && (
        <div
          data-no-frost
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 5000,
            background: "radial-gradient(1100px 600px at 18% -5%, rgba(79,70,229,.22), transparent 55%), rgba(10,13,28,.94)",
            backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            display: "flex", flexDirection: "column",
            padding: "14px 16px", animation: "lpFade .18s ease both", fontFamily: "'DM Sans',sans-serif",
          }}
        >
          {/* Compact top bar: title · search · close */}
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", whiteSpace: "nowrap" }}>
              {hospital}<span style={{ color: "#a5b4fc" }}> · Menu</span>
            </span>
            <div style={{ position: "relative", flex: 1, maxWidth: 520 }}>
              <i className="pi pi-search" style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: 14 }} />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && tiles[0]) go(tiles[0].path); }}
                placeholder="Search modules & pages…"
                style={{
                  width: "100%", padding: "9px 14px 9px 38px", fontSize: 13.5,
                  borderRadius: 11, border: "1.5px solid rgba(255,255,255,.18)",
                  background: "rgba(255,255,255,.09)", color: "#fff", outline: "none",
                  fontFamily: "'DM Sans',sans-serif",
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>{tiles.length} pages</span>
            <button onClick={() => setOpen(false)} title="Close (Esc)"
              style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(255,255,255,.08)", color: "#e2e8f0", cursor: "pointer", flexShrink: 0 }}>
              <i className="pi pi-times" style={{ fontSize: 13 }} />
            </button>
          </div>

          {/* Dense tile grid — fills remaining height, sized to avoid scroll */}
          <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {tiles.length === 0 ? (
              <div style={{ textAlign: "center", color: "#94a3b8", padding: 50, fontSize: 14 }}>
                <i className="pi pi-inbox" style={{ fontSize: 32, display: "block", marginBottom: 10, color: "#475569" }} />
                No module matches “{q}”.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(102px, 1fr))", gap: 7, alignContent: "start" }}>
                {tiles.map((it, i) => {
                  const active = isActive(it.path);
                  return (
                    <button
                      key={it.path + it.label + i}
                      onClick={() => go(it.path)}
                      className="lp-tile"
                      title={`${it.group} · ${it.label}`}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5,
                        padding: "6px 8px 6px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                        background: active ? `linear-gradient(135deg, ${it.color}, ${it.color}cc)` : "rgba(255,255,255,.085)",
                        borderTop: "1px solid rgba(255,255,255,.16)",
                        borderRight: "1px solid rgba(255,255,255,.16)",
                        borderBottom: "1px solid rgba(255,255,255,.16)",
                        borderLeft: `3px solid ${it.color}`,
                        boxShadow: active ? `0 6px 16px ${it.color}55` : "0 1px 2px rgba(0,0,0,.25)",
                        color: "#fff", position: "relative", minHeight: 50,
                        transition: "transform .12s, background .14s",
                        animation: "lpTileIn .2s ease both",
                        animationDelay: `${Math.min(i, 30) * 9}ms`,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; if (!active) e.currentTarget.style.background = "rgba(255,255,255,.2)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; if (!active) e.currentTarget.style.background = "rgba(255,255,255,.085)"; }}
                    >
                      <span style={{
                        width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                        background: active ? "rgba(255,255,255,.22)" : it.color + "44",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <i className={`pi ${it.icon}`} style={{ fontSize: 12, color: active ? "#fff" : "#fff" }} />
                      </span>
                      <span style={{
                        fontSize: 10.5, fontWeight: 600, lineHeight: 1.2, width: "100%",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{it.label}</span>
                      {it.badge && (
                        <span style={{
                          position: "absolute", top: 7, right: 7, fontSize: 7.5, fontWeight: 800, letterSpacing: ".3px",
                          color: "#fff", background: badgeColor(it.badge), padding: "1px 4px", borderRadius: 4,
                        }}>{it.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes lpFade { from { opacity:0; } to { opacity:1; } }
        @keyframes lpTileIn { from { opacity:0; transform: translateY(8px) scale(.96); } to { opacity:1; transform:none; } }
        @media (prefers-reduced-motion: reduce) { .lp-tile { animation: none !important; } }
      `}</style>
    </>
  );
}
