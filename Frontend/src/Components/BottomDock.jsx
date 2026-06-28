/**
 * BottomDock.jsx — R7hr-306 (USER)
 * Replaces the left Sidebar with a bottom "carousel" dock of section
 * icons (collapsed ~1cm, expands on hover to reveal labels). Clicking a
 * section icon spawns its nav items as floating QUICK-ACCESS TILES that
 * fill a left column top→bottom, then overflow into a top row right→left.
 * Replace mode (one section's tiles at a time), per-tile ✕, Clear-all.
 * Reuses the exact role-based NAV from Sidebar.jsx.
 */
import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useHospitalSettings } from "../context/HospitalSettingsContext";
import { NAV, filterNav, ROLE_META } from "./Sidebar";
import "primeicons/primeicons.css";

const DOCK_H = 40;        // collapsed (~1cm)
const DOCK_H_OPEN = 76;   // expanded on hover (icon + label)
const HEADER_H = 52;
const TILE_W = 168, TILE_H = 58, GAP = 10, PAD = 12;

const badgeColor = (b) =>
  b === "LIVE" ? "#dc2626" : b === "NEW" ? "#d97706" : b === "NABH" ? "#7c3aed" :
  b === "ALL-IN-ONE" ? "#0891b2" : b === "COUNTER" ? "#d97706" : "#64748b";

export default function BottomDock() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { settings } = useHospitalSettings();

  const userRole = user?.role || "Admin";
  const roleMeta = ROLE_META[userRole] || ROLE_META.Admin;
  const visibleNav = useMemo(() => filterNav(NAV, userRole), [userRole]);

  const [dockHover, setDockHover]       = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [removed, setRemoved]           = useState({});
  const [vp, setVp] = useState({
    w: window.innerWidth || document.documentElement.clientWidth || 1280,
    h: window.innerHeight || document.documentElement.clientHeight || 800,
  });

  useEffect(() => {
    const onResize = () => setVp({
      w: window.innerWidth || document.documentElement.clientWidth || 1280,
      h: window.innerHeight || document.documentElement.clientHeight || 800,
    });
    onResize();  // re-measure once after mount (layout ready) — fixes zero-width at first paint
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isActive = (path) => {
    if (!path) return false;
    const [p, q] = path.split("?");
    if (location.pathname !== p && !location.pathname.startsWith(p + "/")) return false;
    if (!q) return true;
    const want = new URLSearchParams(q), have = new URLSearchParams(location.search);
    for (const [k, v] of want) if (have.get(k) !== v) return false;
    return true;
  };

  const section = visibleNav.find((s) => s.id === activeSection) || null;
  const items = section && !section.single && section.items ? section.items : [];
  const tiles = items.filter((it) => !removed[`${activeSection}:${it.path}:${it.label}`]);

  const onSectionClick = (s) => {
    if (s.single || !s.items?.length) { navigate(s.path); setActiveSection(null); return; }
    setActiveSection((cur) => (cur === s.id ? null : s.id));
    setRemoved({});  // Replace mode — fresh set
  };

  // left column top→bottom, overflow into a top row right→left
  const availH = vp.h - HEADER_H - DOCK_H - PAD * 2;
  const colCap = Math.max(1, Math.floor(availH / (TILE_H + GAP)));
  const tilePos = (i) =>
    i < colCap
      ? { left: PAD, top: HEADER_H + PAD + i * (TILE_H + GAP) }
      : { left: vp.w - PAD - (i - colCap + 1) * (TILE_W + GAP) + GAP, top: HEADER_H + PAD };

  const initials = (settings?.hospitalName || "S").charAt(0).toUpperCase();

  return (
    <>
      {/* ── Quick-access tiles overlay ── */}
      {section && tiles.length > 0 && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 850 }}>
          {/* Clear-all chip, just above the dock */}
          <button
            onClick={() => setActiveSection(null)}
            style={{
              position: "fixed", left: PAD, bottom: DOCK_H + 12, zIndex: 851,
              pointerEvents: "auto", display: "inline-flex", alignItems: "center", gap: 6,
              background: "#1e1b4b", color: "#c7d2fe", border: "1px solid #3730a3",
              borderRadius: 999, padding: "5px 12px", fontSize: 11, fontWeight: 700,
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
              boxShadow: "0 6px 18px rgba(16,24,40,.22)",
            }}
          >
            <i className="pi pi-times-circle" style={{ fontSize: 12 }} />
            Clear · {section.label}
          </button>

          {tiles.map((it, i) => {
            const pos = tilePos(i);
            const active = isActive(it.path);
            const key = `${activeSection}:${it.path}:${it.label}`;
            return (
              <div
                key={key}
                className="dock-tile"
                onClick={() => navigate(it.path)}
                style={{
                  position: "fixed", left: pos.left, top: pos.top,
                  width: TILE_W, height: TILE_H, pointerEvents: "auto",
                  background: active ? `linear-gradient(135deg, ${section.color}, ${section.color}cc)` : "#fff",
                  color: active ? "#fff" : "#1e293b",
                  border: `1.5px solid ${active ? section.color : "#e2e8f0"}`,
                  borderRadius: 12, padding: "0 12px",
                  display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                  boxShadow: active
                    ? `0 8px 22px ${section.color}40`
                    : "0 1px 2px rgba(16,24,40,.05), 0 6px 16px rgba(16,24,40,.10)",
                  fontFamily: "'DM Sans',sans-serif",
                  transition: "transform .12s, box-shadow .15s",
                  animation: "dockTileIn .22s cubic-bezier(.34,1.4,.64,1) both",
                  animationDelay: `${Math.min(i, 12) * 25}ms`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: active ? "rgba(255,255,255,.2)" : section.color + "18",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <i className={`pi ${it.icon}`} style={{ fontSize: 14, color: active ? "#fff" : section.color }} />
                </div>
                <span style={{
                  flex: 1, fontSize: 12.5, fontWeight: 700, lineHeight: 1.15,
                  overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                }}>{it.label}</span>
                {it.badge && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: ".4px",
                    color: active ? "#fff" : badgeColor(it.badge),
                    background: active ? "rgba(255,255,255,.2)" : badgeColor(it.badge) + "18",
                    border: `1px solid ${active ? "rgba(255,255,255,.3)" : badgeColor(it.badge) + "33"}`,
                    padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                  }}>{it.badge}</span>
                )}
                <button
                  className="dock-tile__x"
                  title="Remove tile"
                  onClick={(e) => { e.stopPropagation(); setRemoved((r) => ({ ...r, [key]: true })); }}
                  style={{
                    position: "absolute", top: -7, right: -7, width: 18, height: 18,
                    borderRadius: "50%", border: "none", cursor: "pointer",
                    background: "#1e293b", color: "#fff", fontSize: 9,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,.25)",
                  }}
                >
                  <i className="pi pi-times" style={{ fontSize: 9 }} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bottom dock (carousel) ── */}
      <div
        onMouseEnter={() => setDockHover(true)}
        onMouseLeave={() => setDockHover(false)}
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 900,
          height: dockHover ? DOCK_H_OPEN : DOCK_H,
          background: "linear-gradient(180deg, rgba(30,27,75,.97), rgba(49,46,129,.97))",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          borderTop: "1px solid rgba(255,255,255,.12)",
          boxShadow: "0 -8px 28px rgba(16,24,40,.22)",
          display: "flex", alignItems: dockHover ? "flex-start" : "center", gap: 3,
          padding: dockHover ? "8px 12px 0" : "0 12px",
          overflowX: "auto", overflowY: "hidden",
          transition: "height .22s cubic-bezier(.4,0,.2,1), padding .22s, align-items .22s",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        {visibleNav.map((s) => {
          const open = activeSection === s.id;
          const anyActive = s.single ? isActive(s.path) : s.items?.some((i) => isActive(i.path));
          const hot = open || anyActive;
          return (
            <button
              key={s.id}
              onClick={() => onSectionClick(s)}
              title={s.label}
              style={{
                flexShrink: 0, border: "none", background: "transparent", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: dockHover ? "2px 6px" : "0 4px", borderRadius: 10,
              }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                background: hot ? s.color : "rgba(255,255,255,.10)",
                border: open ? "1.5px solid rgba(255,255,255,.5)" : "1.5px solid transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background .15s, transform .15s",
                boxShadow: hot ? `0 4px 12px ${s.color}55` : "none",
              }}>
                <i className={`pi ${s.icon}`} style={{ fontSize: 14, color: hot ? "#fff" : "#cbd5e1" }} />
              </div>
              {dockHover && (
                <span style={{
                  fontSize: 9.5, fontWeight: 600, color: hot ? "#fff" : "#94a3b8",
                  maxWidth: 64, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{s.label}</span>
              )}
            </button>
          );
        })}

        {/* User + logout pinned right */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingTop: dockHover ? 2 : 0 }}>
          {dockHover && user && (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#cbd5e1", whiteSpace: "nowrap", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.fullName || user.email}
            </span>
          )}
          <div style={{
            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
            background: `linear-gradient(135deg, ${roleMeta.color}, ${roleMeta.color}aa)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 800, color: "#fff",
          }} title={`${user?.fullName || ""} — ${roleMeta.label}`}>{initials}</div>
          <button
            onClick={logout}
            title="Logout"
            style={{
              border: "none", background: "rgba(255,255,255,.1)", color: "#cbd5e1",
              width: 28, height: 28, borderRadius: 8, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            <i className="pi pi-sign-out" style={{ fontSize: 12 }} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes dockTileIn { from { opacity:0; transform: translateY(8px) scale(.96); } to { opacity:1; transform: none; } }
        .dock-tile:hover .dock-tile__x { background:#dc2626; }
      `}</style>
    </>
  );
}
