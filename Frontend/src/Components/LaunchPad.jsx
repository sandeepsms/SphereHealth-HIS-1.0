/**
 * LaunchPad.jsx — R7hu (USER, 2026-07-04) full redesign.
 * App-launcher navigation replacing the sidebar. Floating button (or Alt+Space)
 * opens a full-screen command-palette-style launcher:
 *
 *   • Search-first: big command bar, autofocus, Enter opens the top match.
 *   • Section chips: one tap filters to a module group (colour-coded).
 *   • Pinned: star any tile — persists per role in localStorage.
 *   • Recents: last 8 visited pages, one-tap re-entry.
 *   • Grouped grid: tiles clustered under labelled section headers instead of
 *     one undifferentiated wall of 80+ identical tiles.
 *   • Full keyboard nav: ↑↓←→ roving highlight, Enter opens, Esc clears/closes,
 *     Alt+Space toggles. Mouse hover and keyboard share one highlight.
 *   • Motion: 180ms glass fade/scale in, 140ms out (exit faster than enter),
 *     staggered tile entrance (12ms/tile, capped) only on open — not on every
 *     keystroke; transform/opacity only; prefers-reduced-motion kills all.
 *
 * Reuses the role-based NAV from Sidebar; navigation still goes through
 * navigate() so the instant route splash (BrandTransition) takes over.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useHospitalSettings } from "../context/HospitalSettingsContext";
import { NAV, filterNav } from "./Sidebar";
import "primeicons/primeicons.css";

const badgeColor = (b) =>
  b === "LIVE" ? "#dc2626" : b === "NEW" ? "#d97706" : b === "NABH" ? "#7c3aed" :
  b === "ALL-IN-ONE" ? "#0891b2" : b === "COUNTER" ? "#d97706" : "#64748b";

/* localStorage helpers — per-role pins + recents, always safe */
const store = {
  get(key) { try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : []; } catch { return []; } },
  set(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* full/blocked */ } },
};

export default function LaunchPad() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { settings } = useHospitalSettings();
  const userRole = user?.role || "Admin";
  const visibleNav = useMemo(() => filterNav(NAV, userRole), [userRole]);

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [q, setQ] = useState("");
  const [sectionId, setSectionId] = useState("all");
  const [hi, setHi] = useState(0);                 // roving highlight (flat index)
  const [stagger, setStagger] = useState(false);   // entrance animation only on open
  const [pins, setPins] = useState(() => store.get(`bims.lp.pins.${userRole}`));
  const [recents, setRecents] = useState(() => store.get(`bims.lp.recents.${userRole}`));
  const searchRef = useRef(null);
  const gridRef = useRef(null);                    // first tile grid — column count probe
  const tileRefs = useRef({});                     // flat index → element

  /* ── Section + tile model ──────────────────────────────────── */
  const sections = useMemo(() => {
    const out = [];
    visibleNav.forEach((s) => {
      const items = (s.single || !s.items?.length)
        ? (s.path ? [{ label: s.label, icon: s.icon, path: s.path, badge: s.badge }] : [])
        : s.items;
      if (!items.length) return;
      out.push({
        id: s.id || s.label, label: s.label, icon: s.icon, color: s.color || "#6366f1",
        items: items.map((it) => ({ ...it, color: s.color || "#6366f1", group: s.label, sectionId: s.id || s.label })),
      });
    });
    return out;
  }, [visibleNav]);

  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const byPath = useMemo(() => { const m = new Map(); allItems.forEach((it) => { if (!m.has(it.path)) m.set(it.path, it); }); return m; }, [allItems]);

  /* Filtered groups + flat keyboard order (flat index assigned per tile) */
  const { groups, flat } = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const hit = (it) => !ql || it.label.toLowerCase().includes(ql) || it.group.toLowerCase().includes(ql);
    const gs = [];
    const fl = [];
    sections.forEach((s) => {
      if (sectionId !== "all" && s.id !== sectionId) return;
      const items = s.items.filter(hit).map((it) => {
        const withIdx = { ...it, fi: fl.length };
        fl.push(withIdx);
        return withIdx;
      });
      if (items.length) gs.push({ ...s, items });
    });
    return { groups: gs, flat: fl };
  }, [sections, q, sectionId]);

  const pinnedTiles = useMemo(() => pins.map((p) => byPath.get(p)).filter(Boolean), [pins, byPath]);
  const recentTiles = useMemo(
    () => recents.map((p) => byPath.get(p)).filter(Boolean).filter((it) => !pins.includes(it.path)).slice(0, 8),
    [recents, byPath, pins],
  );

  /* ── Open / close choreography ─────────────────────────────── */
  const doOpen = useCallback(() => {
    setOpen(true); setClosing(false); setQ(""); setSectionId("all"); setHi(0);
    setStagger(true);
    setTimeout(() => setStagger(false), 700);      // stagger only for the entrance
    setTimeout(() => searchRef.current?.focus(), 80);
  }, []);
  const doClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 150); // exit faster than enter
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && (e.code === "Space" || e.key === " ")) { e.preventDefault(); open ? doClose() : doOpen(); }
      else if (e.key === "Escape" && open) { q ? setQ("") : doClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, q, doOpen, doClose]);

  /* Reset highlight when the visible list changes */
  useEffect(() => { setHi(0); }, [q, sectionId]);

  const isActive = (path) => {
    if (!path) return false;
    const [p] = path.split("?");
    return location.pathname === p || location.pathname.startsWith(p + "/");
  };

  const go = useCallback((path) => {
    if (!path) return;
    setRecents((r) => {
      const next = [path, ...r.filter((x) => x !== path)].slice(0, 12);
      store.set(`bims.lp.recents.${userRole}`, next);
      return next;
    });
    navigate(path);
    doClose();
  }, [navigate, userRole, doClose]);

  const togglePin = useCallback((path, e) => {
    e.stopPropagation();
    setPins((p) => {
      const next = p.includes(path) ? p.filter((x) => x !== path) : [...p, path].slice(-16);
      store.set(`bims.lp.pins.${userRole}`, next);
      return next;
    });
  }, [userRole]);

  /* ── Keyboard: roving highlight over the flat list ─────────── */
  const cols = () => {
    const g = gridRef.current;
    if (!g) return 4;
    try { return Math.max(1, getComputedStyle(g).gridTemplateColumns.split(" ").length); } catch { return 4; }
  };
  const moveHi = (delta) => {
    if (!flat.length) return;
    setHi((h) => {
      const n = Math.min(flat.length - 1, Math.max(0, h + delta));
      tileRefs.current[n]?.scrollIntoView({ block: "nearest" });
      return n;
    });
  };
  const onSearchKeyDown = (e) => {
    if (e.key === "Enter") { const t = flat[hi] || flat[0]; if (t) go(t.path); }
    else if (e.key === "ArrowDown")  { e.preventDefault(); moveHi(+cols()); }
    else if (e.key === "ArrowUp")    { e.preventDefault(); moveHi(-cols()); }
    else if (e.key === "ArrowRight") { if (searchCaretAtEnd(e)) { e.preventDefault(); moveHi(+1); } }
    else if (e.key === "ArrowLeft")  { if (e.target.selectionStart === 0 && !q) { e.preventDefault(); moveHi(-1); } }
    else if (e.key === "Home" && !q) { e.preventDefault(); setHi(0); tileRefs.current[0]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "End" && !q)  { e.preventDefault(); setHi(flat.length - 1); tileRefs.current[flat.length - 1]?.scrollIntoView({ block: "nearest" }); }
  };
  const searchCaretAtEnd = (e) => e.target.selectionStart === (e.target.value || "").length;

  const hospital = settings?.hospitalName || "Hospital";

  /* ── Tile (shared by pinned strip + section grids) ─────────── */
  const Tile = (it, opts = {}) => {
    const active = isActive(it.path);
    const highlighted = !opts.noHi && it.fi === hi;
    const pinned = pins.includes(it.path);
    return (
      <button
        key={(opts.keyPrefix || "") + it.path + it.label}
        ref={(el) => { if (!opts.noHi && it.fi != null) tileRefs.current[it.fi] = el; }}
        onClick={() => go(it.path)}
        onMouseMove={() => { if (!opts.noHi && it.fi != null && it.fi !== hi) setHi(it.fi); }}
        className={`lp2-tile ${highlighted ? "lp2-hi" : ""} ${active ? "lp2-active" : ""} ${stagger ? "lp2-stag" : ""}`}
        style={{ "--c": it.color, animationDelay: stagger ? `${Math.min((it.fi ?? 0) * 12, 260)}ms` : undefined }}
        title={`${it.group} · ${it.label}`}
        aria-label={`${it.label} — ${it.group}`}
      >
        <span className="lp2-ico"><i className={`pi ${it.icon}`} /></span>
        <span className="lp2-lbl">
          {it.label}
          {it.group !== it.label ? <span className="lp2-grp">{it.group}</span> : null}
        </span>
        {it.badge && <span className="lp2-badge" style={{ background: badgeColor(it.badge) }}>{it.badge}</span>}
        {active && <span className="lp2-here" title="You are here" />}
        <span
          role="button"
          tabIndex={-1}
          aria-label={pinned ? `Unpin ${it.label}` : `Pin ${it.label}`}
          className={`lp2-pin ${pinned ? "lp2-pinned" : ""}`}
          onClick={(e) => togglePin(it.path, e)}
        >
          <i className={`pi ${pinned ? "pi-star-fill" : "pi-star"}`} />
        </span>
      </button>
    );
  };

  return (
    <>
      {/* ── Floating launcher trigger (bottom-left) ── */}
      <button
        onClick={doOpen}
        title="Open menu — Alt+Space"
        aria-label="Open menu"
        className="lp2-trigger"
      >
        <i className="pi pi-th-large" style={{ fontSize: 21 }} />
      </button>

      {/* ── Launcher overlay ── */}
      {open && (
        <div
          data-no-frost
          role="dialog"
          aria-modal="true"
          aria-label="App launcher"
          onClick={doClose}
          className={`lp2-overlay ${closing ? "lp2-closing" : ""}`}
        >
          <div className="lp2-panel" onClick={(e) => e.stopPropagation()}>

            {/* Command bar */}
            <div className="lp2-head">
              <span className="lp2-brand">
                <span className="lp2-brand-dot" />
                {hospital}
              </span>
              <div className="lp2-searchwrap">
                <i className="pi pi-search" />
                <input
                  ref={searchRef}
                  className="lp2-searchbox"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search pages, modules…"
                  aria-label="Search pages"
                />
                {q ? (
                  <button className="lp2-clear" onClick={() => setQ("")} aria-label="Clear search"><i className="pi pi-times-circle" /></button>
                ) : (
                  <span className="lp2-kbdhint">Alt + Space</span>
                )}
              </div>
              <span className="lp2-count">{flat.length} page{flat.length === 1 ? "" : "s"}</span>
              <button className="lp2-close" onClick={doClose} title="Close (Esc)" aria-label="Close launcher">
                <i className="pi pi-times" />
              </button>
            </div>

            {/* Section chips */}
            <div className="lp2-chips" role="tablist" aria-label="Module sections">
              <button
                role="tab" aria-selected={sectionId === "all"}
                className={`lp2-chip ${sectionId === "all" ? "lp2-chip-on" : ""}`}
                style={{ "--c": "#6366f1" }}
                onClick={() => setSectionId("all")}
              >
                <i className="pi pi-th-large" /> All
              </button>
              {sections.map((s) => (
                <button
                  key={s.id}
                  role="tab" aria-selected={sectionId === s.id}
                  className={`lp2-chip ${sectionId === s.id ? "lp2-chip-on" : ""}`}
                  style={{ "--c": s.color }}
                  onClick={() => setSectionId(sectionId === s.id ? "all" : s.id)}
                  title={`${s.label} · ${s.items.length}`}
                >
                  <i className={`pi ${s.icon}`} /> {s.label}
                  <em>{s.items.length}</em>
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="lp2-body">
              {/* Pinned + Recent — only in the default view */}
              {!q && sectionId === "all" && (pinnedTiles.length > 0 || recentTiles.length > 0) && (
                <div className="lp2-quick">
                  {pinnedTiles.length > 0 && (
                    <div className="lp2-sec">
                      <div className="lp2-sechead" style={{ "--c": "#f59e0b" }}>
                        <span className="lp2-secico"><i className="pi pi-star-fill" /></span>
                        Pinned
                      </div>
                      <div className="lp2-grid">{pinnedTiles.map((it) => Tile(it, { noHi: true, keyPrefix: "pin-" }))}</div>
                    </div>
                  )}
                  {recentTiles.length > 0 && (
                    <div className="lp2-sec">
                      <div className="lp2-sechead" style={{ "--c": "#38bdf8" }}>
                        <span className="lp2-secico"><i className="pi pi-history" /></span>
                        Recent
                      </div>
                      <div className="lp2-recent">
                        {recentTiles.map((it) => (
                          <button key={"rc-" + it.path} className="lp2-rchip" style={{ "--c": it.color }} onClick={() => go(it.path)} title={it.group}>
                            <i className={`pi ${it.icon}`} /> {it.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Grouped sections */}
              {groups.length === 0 ? (
                <div className="lp2-empty">
                  <i className="pi pi-inbox" />
                  <div>No page matches “{q}”.</div>
                  <button onClick={() => { setQ(""); searchRef.current?.focus(); }}>Clear search</button>
                </div>
              ) : (
                groups.map((s, gi) => (
                  <div className="lp2-sec" key={s.id}>
                    <div className="lp2-sechead" style={{ "--c": s.color }}>
                      <span className="lp2-secico"><i className={`pi ${s.icon}`} /></span>
                      {s.label}
                      <em>{s.items.length}</em>
                    </div>
                    <div className="lp2-grid" ref={gi === 0 ? gridRef : undefined}>
                      {s.items.map((it) => Tile(it))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer hints */}
            <div className="lp2-foot">
              <span><kbd>↑↓←→</kbd> Navigate</span>
              <span><kbd>↵</kbd> Open</span>
              <span><kbd>Esc</kbd> {q ? "Clear" : "Close"}</span>
              <span><kbd>Alt</kbd>+<kbd>Space</kbd> Toggle</span>
              <span><i className="pi pi-star" style={{ fontSize: 10 }} /> Pin favourites</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .lp2-trigger {
          position: fixed; left: 18px; bottom: 18px; z-index: 1500;
          width: 52px; height: 52px; border-radius: 15px;
          border: 1px solid rgba(255,255,255,.18);
          background: linear-gradient(135deg, #4f46e5, #4338ca 55%, #7c3aed);
          color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 10px 28px rgba(67,56,202,.45), inset 0 1px 0 rgba(255,255,255,.25);
          transition: transform .16s cubic-bezier(.34,1.56,.64,1), box-shadow .18s;
        }
        .lp2-trigger:hover { transform: translateY(-3px) scale(1.06); box-shadow: 0 14px 34px rgba(67,56,202,.55), inset 0 1px 0 rgba(255,255,255,.25); }
        .lp2-trigger:active { transform: scale(.95); }

        .lp2-overlay {
          position: fixed; inset: 0; z-index: 5000;
          background:
            radial-gradient(1200px 640px at 18% -6%, rgba(79,70,229,.26), transparent 55%),
            radial-gradient(900px 520px at 92% 108%, rgba(124,58,237,.16), transparent 60%),
            rgba(8,10,24,.9);
          backdrop-filter: blur(18px) saturate(1.15); -webkit-backdrop-filter: blur(18px) saturate(1.15);
          display: flex; align-items: stretch; justify-content: center;
          animation: lp2Fade .18s ease-out both;
          font-family: 'DM Sans', sans-serif;
        }
        .lp2-overlay.lp2-closing { animation: lp2FadeOut .14s ease-in both; }
        .lp2-panel {
          width: min(1180px, 100%); display: flex; flex-direction: column;
          padding: 18px 20px 10px; min-height: 0;
          animation: lp2Rise .2s cubic-bezier(.21,1.02,.55,1) both;
        }
        .lp2-closing .lp2-panel { animation: lp2Sink .14s ease-in both; }

        /* ── Command bar ── */
        .lp2-head { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
        .lp2-brand { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; color: #fff; white-space: nowrap; letter-spacing: .2px; }
        .lp2-brand-dot { width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg,#818cf8,#c084fc); box-shadow: 0 0 10px #818cf8aa; }
        .lp2-searchwrap { position: relative; flex: 1; max-width: 620px; display: flex; align-items: center; }
        .lp2-searchwrap > .pi-search { position: absolute; left: 16px; color: #94a3b8; font-size: 15px; pointer-events: none; }
        /* R7hr — the input carries the .lp2-searchbox class ON PURPOSE: two
           global bare-input resets would otherwise collapse the left/right
           padding (search icon overlapping the "Sea🔍rch pages…" placeholder,
           Alt+Space hint overlapping the text) — input:not([class]){padding:9px
           12px} (any class opts out) AND input[class*="input"]{padding:9px 12px}
           (so the class name must NOT contain "input", hence "searchbox"). The
           padding is !important so no future [class*=…] reset can defeat it
           again — the icon needs 44px on the left, the hint 96px on the right. */
        .lp2-searchwrap .lp2-searchbox {
          width: 100%; padding: 13px 96px 13px 44px !important; font-size: 14.5px; color: #fff;
          border-radius: 14px; border: 1.5px solid rgba(255,255,255,.16);
          background: rgba(255,255,255,.08); outline: none; font-family: inherit;
          box-sizing: border-box;
        }
        .lp2-searchwrap .lp2-searchbox { transition: border-color .15s, background .15s, box-shadow .15s; }
        .lp2-searchwrap .lp2-searchbox::placeholder { color: #8b93a7; }
        .lp2-searchwrap .lp2-searchbox:focus { border-color: #818cf8; background: rgba(255,255,255,.11); box-shadow: 0 0 0 4px rgba(99,102,241,.22); }
        .lp2-kbdhint { position: absolute; right: 12px; font-size: 10.5px; color: #8b93a7; border: 1px solid rgba(255,255,255,.14); border-radius: 7px; padding: 3px 8px; pointer-events: none; }
        .lp2-clear { position: absolute; right: 10px; background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 15px; padding: 4px; }
        .lp2-clear:hover { color: #fff; }
        .lp2-count { font-size: 11.5px; color: #8b93a7; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .lp2-close {
          width: 38px; height: 38px; border-radius: 12px; flex-shrink: 0; cursor: pointer;
          border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.07); color: #e2e8f0;
          transition: background .14s, transform .14s;
        }
        .lp2-close:hover { background: rgba(255,255,255,.16); transform: rotate(90deg); }

        /* ── Section chips ── */
        .lp2-chips {
          display: flex; gap: 7px; margin: 13px 0 4px; padding-bottom: 6px; flex-shrink: 0;
          overflow-x: auto; scrollbar-width: none;
        }
        .lp2-chips::-webkit-scrollbar { display: none; }
        .lp2-chip {
          display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
          padding: 8px 13px; border-radius: 999px; font-size: 12px; font-weight: 700; cursor: pointer;
          color: #cbd5e1; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.13);
          font-family: inherit; transition: background .14s, color .14s, border-color .14s, transform .14s;
        }
        .lp2-chip .pi { font-size: 12px; color: var(--c); }
        .lp2-chip em { font-style: normal; font-size: 10px; color: #8b93a7; font-variant-numeric: tabular-nums; }
        .lp2-chip:hover { background: rgba(255,255,255,.12); transform: translateY(-1px); }
        .lp2-chip-on { background: color-mix(in srgb, var(--c) 26%, transparent); border-color: color-mix(in srgb, var(--c) 60%, transparent); color: #fff; }
        .lp2-chip-on .pi, .lp2-chip-on em { color: #fff; }

        /* ── Body / sections ── */
        .lp2-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 2px 12px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent; }
        .lp2-sec { margin-bottom: 16px; }
        .lp2-sechead {
          display: flex; align-items: center; gap: 9px; margin: 2px 0 8px;
          font-size: 11.5px; font-weight: 800; letter-spacing: 1.1px; text-transform: uppercase; color: #cbd5e1;
        }
        .lp2-sechead em { font-style: normal; font-weight: 700; font-size: 10px; color: #8b93a7; }
        .lp2-sechead::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, color-mix(in srgb, var(--c) 45%, transparent), transparent 70%); }
        .lp2-secico {
          width: 22px; height: 22px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--c) 30%, transparent); color: #fff;
        }
        .lp2-secico .pi { font-size: 11px; }
        .lp2-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px; }

        /* ── Tile ── */
        .lp2-tile {
          position: relative; display: flex; align-items: center; gap: 10px; text-align: left;
          min-height: 56px; padding: 9px 30px 9px 10px; border-radius: 13px; cursor: pointer;
          color: #fff; font-family: inherit;
          background: rgba(255,255,255,.065);
          border: 1px solid rgba(255,255,255,.11);
          transition: transform .14s cubic-bezier(.34,1.4,.64,1), background .14s, border-color .14s, box-shadow .14s;
        }
        .lp2-tile.lp2-stag { animation: lp2TileIn .26s cubic-bezier(.21,1.02,.55,1) both; }
        .lp2-tile:hover, .lp2-tile.lp2-hi {
          transform: translateY(-2px);
          background: color-mix(in srgb, var(--c) 16%, rgba(255,255,255,.06));
          border-color: color-mix(in srgb, var(--c) 55%, transparent);
          box-shadow: 0 8px 22px color-mix(in srgb, var(--c) 28%, transparent);
        }
        .lp2-tile:active { transform: scale(.97); }
        .lp2-tile:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
        .lp2-tile.lp2-active { background: linear-gradient(135deg, color-mix(in srgb, var(--c) 82%, #000), color-mix(in srgb, var(--c) 60%, #000)); border-color: color-mix(in srgb, var(--c) 80%, #fff); }
        .lp2-ico {
          width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--c) 34%, transparent);
          transition: transform .16s cubic-bezier(.34,1.56,.64,1);
        }
        .lp2-tile:hover .lp2-ico, .lp2-tile.lp2-hi .lp2-ico { transform: scale(1.1); }
        .lp2-ico .pi { font-size: 15px; color: #fff; }
        .lp2-lbl { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 12.5px; font-weight: 700; line-height: 1.2; }
        .lp2-lbl, .lp2-grp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lp2-grp { font-size: 9.5px; font-weight: 600; color: #97a0b5; letter-spacing: .3px; }
        .lp2-badge { position: absolute; top: 6px; right: 6px; font-size: 7.5px; font-weight: 800; letter-spacing: .4px; color: #fff; padding: 2px 5px; border-radius: 5px; }
        .lp2-here { position: absolute; left: -1px; top: 50%; transform: translateY(-50%); width: 3px; height: 60%; border-radius: 3px; background: #fff; box-shadow: 0 0 8px #fff8; }
        .lp2-pin {
          position: absolute; right: 7px; bottom: 7px; width: 20px; height: 20px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          color: #cbd5e1; opacity: 0; transition: opacity .13s, background .13s, color .13s;
        }
        .lp2-pin .pi { font-size: 10.5px; }
        .lp2-tile:hover .lp2-pin, .lp2-tile.lp2-hi .lp2-pin { opacity: .85; }
        .lp2-pin:hover { background: rgba(255,255,255,.16); color: #fff; opacity: 1 !important; }
        .lp2-pin.lp2-pinned { opacity: 1; color: #fbbf24; }

        /* ── Recents ── */
        .lp2-recent { display: flex; flex-wrap: wrap; gap: 7px; }
        .lp2-rchip {
          display: inline-flex; align-items: center; gap: 7px; padding: 8px 13px; border-radius: 999px;
          font-size: 12px; font-weight: 700; color: #e2e8f0; cursor: pointer; font-family: inherit;
          background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.13);
          transition: background .14s, transform .14s, border-color .14s;
        }
        .lp2-rchip .pi { font-size: 12px; color: var(--c); }
        .lp2-rchip:hover { background: color-mix(in srgb, var(--c) 18%, transparent); border-color: color-mix(in srgb, var(--c) 50%, transparent); transform: translateY(-1px); }

        /* ── Empty + footer ── */
        .lp2-empty { text-align: center; color: #8b93a7; padding: 60px 0; font-size: 14px; }
        .lp2-empty .pi { font-size: 34px; display: block; margin-bottom: 12px; color: #475569; }
        .lp2-empty button {
          margin-top: 14px; padding: 8px 18px; border-radius: 10px; cursor: pointer; font-family: inherit;
          font-size: 12.5px; font-weight: 700; color: #fff; background: rgba(99,102,241,.35); border: 1px solid rgba(129,140,248,.5);
        }
        .lp2-foot {
          display: flex; gap: 18px; justify-content: center; align-items: center; flex-shrink: 0;
          padding: 9px 0 4px; font-size: 10.5px; color: #7c859c; border-top: 1px solid rgba(255,255,255,.07);
        }
        .lp2-foot kbd {
          font-family: inherit; font-size: 9.5px; color: #cbd5e1; border: 1px solid rgba(255,255,255,.18);
          border-bottom-width: 2px; border-radius: 5px; padding: 1px 5px; background: rgba(255,255,255,.05);
        }

        @keyframes lp2Fade    { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lp2FadeOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes lp2Rise    { from { opacity: 0; transform: translateY(14px) scale(.985) } to { opacity: 1; transform: none } }
        @keyframes lp2Sink    { from { opacity: 1; transform: none } to { opacity: 0; transform: translateY(10px) scale(.99) } }
        @keyframes lp2TileIn  { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }

        @media (max-width: 640px) {
          .lp2-panel { padding: 12px 12px 8px; }
          .lp2-brand { display: none; }
          .lp2-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
          .lp2-foot { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp2-overlay, .lp2-panel, .lp2-tile, .lp2-tile.lp2-stag, .lp2-ico, .lp2-chip, .lp2-rchip, .lp2-close, .lp2-trigger { animation: none !important; transition: none !important; }
        }
      `}</style>
    </>
  );
}
