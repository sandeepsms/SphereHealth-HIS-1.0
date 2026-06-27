/**
 * LaunchPad.jsx — R7hr-307 (USER)
 * App-launcher navigation that replaces the sidebar. A floating button
 * (or Alt+Space) opens a full-screen, searchable grid of every module /
 * page the role can reach — big premium tiles grouped by section, with a
 * smooth zoom-in. Click a tile → navigate + close. Esc / backdrop closes.
 * Reuses the exact role-based NAV/filterNav from Sidebar.
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
  const roleMeta = ROLE_META[userRole] || ROLE_META.Admin;
  const visibleNav = useMemo(() => filterNav(NAV, userRole), [userRole]);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchRef = useRef(null);

  // Open with Alt+Space; close with Esc; focus search on open.
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

  // Build searchable groups from the role-filtered nav.
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const hit = (s) => !ql || s.toLowerCase().includes(ql);
    return visibleNav
      .map((s) => {
        if (s.single || !s.items?.length) {
          return hit(s.label) || hit(s.id)
            ? { section: s, items: [{ label: s.label, icon: s.icon, path: s.path, badge: s.badge }] }
            : null;
        }
        const items = s.items.filter((it) => hit(it.label) || hit(s.label));
        return items.length ? { section: s, items } : null;
      })
      .filter(Boolean);
  }, [visibleNav, q]);

  const go = (path) => { if (path) navigate(path); setOpen(false); };
  const hospital = settings?.hospitalName || "Hospital";

  let tileIdx = 0;

  return (
    <>
      {/* ── Floating launcher trigger (bottom-left) ── */}
      <button
        onClick={() => setOpen(true)}
        title="Open menu — Alt+Space"
        aria-label="Open menu"
        style={{
          position: "fixed", left: 18, bottom: 18, zIndex: 1500,
          width: 54, height: 54, borderRadius: 16, border: "1px solid rgba(255,255,255,.18)",
          background: "linear-gradient(135deg, #4f46e5, #4338ca 55%, #7c3aed)",
          color: "#fff", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 10px 28px rgba(67,56,202,.45), inset 0 1px 0 rgba(255,255,255,.25)",
          transition: "transform .14s, box-shadow .18s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px) scale(1.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
      >
        <i className="pi pi-th-large" style={{ fontSize: 22 }} />
      </button>

      {/* ── Launchpad overlay ── */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 5000,
            background: "radial-gradient(1200px 700px at 20% 0%, rgba(79,70,229,.30), transparent 60%), rgba(15,23,42,.74)",
            backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "42px 24px 36px", overflowY: "auto",
            animation: "lpFade .2s ease both", fontFamily: "'DM Sans',sans-serif",
          }}
        >
          {/* Header: brand + search + close */}
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1180, marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".8px", color: "#a5b4fc", textTransform: "uppercase" }}>
                  {hospital} HIS · Menu
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginTop: 2 }}>
                  Where do you want to go?
                </div>
              </div>
              <button onClick={() => setOpen(false)} title="Close (Esc)"
                style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid rgba(255,255,255,.18)",
                  background: "rgba(255,255,255,.08)", color: "#e2e8f0", cursor: "pointer", flexShrink: 0 }}>
                <i className="pi pi-times" />
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <i className="pi pi-search" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: 16 }} />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { const f = groups[0]?.items[0]; if (f) go(f.path); } }}
                placeholder="Search modules & pages…  (Esc to close)"
                style={{
                  width: "100%", padding: "14px 16px 14px 46px", fontSize: 15,
                  borderRadius: 14, border: "1.5px solid rgba(255,255,255,.18)",
                  background: "rgba(255,255,255,.08)", color: "#fff", outline: "none",
                  fontFamily: "'DM Sans',sans-serif",
                }}
              />
            </div>
          </div>

          {/* Grouped tile grid */}
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1180 }}>
            {groups.length === 0 && (
              <div style={{ textAlign: "center", color: "#94a3b8", padding: 50, fontSize: 14 }}>
                <i className="pi pi-inbox" style={{ fontSize: 34, display: "block", marginBottom: 12, color: "#475569" }} />
                No module matches “{q}”.
              </div>
            )}
            {groups.map((g) => (
              <div key={g.section.id} style={{ marginBottom: 26 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                  <span style={{ width: 24, height: 24, borderRadius: 7, background: g.section.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`pi ${g.section.icon}`} style={{ fontSize: 12, color: "#fff" }} />
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: ".6px", color: "#cbd5e1", textTransform: "uppercase" }}>
                    {g.section.label}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 12 }}>
                  {g.items.map((it) => {
                    const active = isActive(it.path);
                    const delay = Math.min(tileIdx++, 24) * 18;
                    return (
                      <button
                        key={it.path + it.label}
                        onClick={() => go(it.path)}
                        className="lp-tile"
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10,
                          padding: "16px 16px 14px", borderRadius: 16, cursor: "pointer", textAlign: "left",
                          background: active ? `linear-gradient(135deg, ${g.section.color}, ${g.section.color}cc)` : "rgba(255,255,255,.07)",
                          border: `1px solid ${active ? g.section.color : "rgba(255,255,255,.12)"}`,
                          color: "#fff", position: "relative",
                          boxShadow: active ? `0 10px 26px ${g.section.color}55` : "0 4px 14px rgba(0,0,0,.18)",
                          transition: "transform .14s, box-shadow .18s, background .15s",
                          animation: "lpTileIn .26s cubic-bezier(.34,1.4,.64,1) both",
                          animationDelay: `${delay}ms`,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px) scale(1.02)"; e.currentTarget.style.background = active ? "" : "rgba(255,255,255,.13)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.background = active ? `linear-gradient(135deg, ${g.section.color}, ${g.section.color}cc)` : "rgba(255,255,255,.07)"; }}
                      >
                        <span style={{
                          width: 44, height: 44, borderRadius: 13, flexShrink: 0,
                          background: active ? "rgba(255,255,255,.2)" : g.section.color + "26",
                          border: `1px solid ${active ? "rgba(255,255,255,.3)" : g.section.color + "44"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <i className={`pi ${it.icon}`} style={{ fontSize: 19, color: active ? "#fff" : "#c7d2fe" }} />
                        </span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>{it.label}</span>
                        {it.badge && (
                          <span style={{
                            position: "absolute", top: 12, right: 12, fontSize: 8.5, fontWeight: 800, letterSpacing: ".4px",
                            color: "#fff", background: badgeColor(it.badge), padding: "2px 6px", borderRadius: 5,
                          }}>{it.badge}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes lpFade { from { opacity:0; } to { opacity:1; } }
        @keyframes lpTileIn { from { opacity:0; transform: translateY(14px) scale(.94); } to { opacity:1; transform:none; } }
        @media (prefers-reduced-motion: reduce) { .lp-tile { animation: none !important; } }
      `}</style>
    </>
  );
}
