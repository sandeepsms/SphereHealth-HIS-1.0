// Components/anim/GlassBackdrop.jsx
// R7hr-281 (USER): app-wide iOS-glass modal backdrop. When any popup/modal opens,
// the content area behind it frosts (backdrop-filter blur + saturate) like iOS,
// while the SIDEBAR (and the top Header) stay perfectly crisp.
//
// Like PrintCelebrate / GlobalClickFx this is a single global OBSERVER that edits
// NO page source: it watches the DOM for the app's translucent full-screen modal
// scrims (every one is an inline `position:fixed; inset:0; background:rgba(...)`
// div) and tags them with CSS classes that apply the frost. Because it works at
// runtime via classes, it covers all ~50 modals — including the launch-ready
// frozen pages — without touching a single one of their files.
//
// Two tiers:
//   • Normal popups (zIndex < SYSTEM_Z)  → `.hga-glass` + `.hga-glass-inset`
//       The frost starts at the content-area's left/top edge, so the sidebar +
//       header are NOT covered and stay sharp + interactive (iOS glass look).
//   • System blockers (zIndex >= SYSTEM_Z, e.g. the forced password-change
//       overlay in AuthContext) → `.hga-glass` only, staying full-screen so they
//       keep blocking the whole app (security: sidebar must not be reachable).
//
// Honours @media print (frost removed) — see animations.css.
import { useEffect } from "react";

// scrims at/above this z-index are treated as full-screen system blockers and are
// frosted but NOT inset (they must keep covering the sidebar). The app's normal
// modals live at z 999–9999; the forced-password blocker is z 99999.
const SYSTEM_Z = 50000;
const HEADER_H = 52; // top app bar height (Header.jsx is fixed top:0 height:52)

// elements we must never treat as modal scrims (global effect layers).
const EXCLUDE_CLASSES = ["click-fx-host", "print-burst-host"];

function alphaOf(bg) {
  // backgroundColor is serialised as "rgb(r, g, b)" or "rgba(r, g, b, a)".
  if (!bg) return 0;
  if (bg === "transparent") return 0;
  const m = bg.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1; // a named/opaque colour → treat as opaque
  const parts = m[1].split(",").map((s) => s.trim());
  return parts.length >= 4 ? parseFloat(parts[3]) : 1;
}

function isScrim(el) {
  if (!el || el.nodeType !== 1 || !el.isConnected) return false;
  if (el.classList.contains("hga-glass")) return false; // idempotent — already frosted
  for (const c of EXCLUDE_CLASSES) if (el.classList.contains(c)) return false;
  if (el.closest("[data-no-frost],[data-scrim-ignore]")) return false; // explicit opt-out
  const cs = getComputedStyle(el);
  if (cs.position !== "fixed") return false;
  if (cs.pointerEvents === "none") return false; // effect/decoration layers (click-fx, print-burst)
  if (cs.visibility === "hidden" || cs.display === "none") return false;
  if (cs.display !== "flex" && cs.display !== "grid") return false; // every real scrim centres via flex/grid
  const z = parseFloat(cs.zIndex);
  if (!Number.isFinite(z) || z < 50) return false; // lowest real scrim is z:50 (PharmacyLedger)
  // translucent ONLY: rejects invisible dropdown dismiss-catchers (alpha 0) AND
  // opaque blockers like the ErrorBoundary crash screen (alpha 1 → must stay solid).
  const a = alphaOf(cs.backgroundColor);
  if (!(a > 0.02 && a < 0.99)) return false;
  if (!el.firstElementChild) return false; // a backdrop wraps a dialog card
  // near-full-viewport at detection time (before we inset it); tolerate a scrollbar.
  const r = el.getBoundingClientRect();
  if (r.top > 6 || r.left > 6) return false; // rejects Header(top0 h52), Sidebar(top52), corner toasts
  if (r.width < window.innerWidth - 24 || r.height < window.innerHeight - 8) return false;
  return true;
}

// the left edge of the content area = the sidebar's right edge. `.main-content`
// carries margin-left:260 (sidebar open) / 64 (collapsed); its rect.left is the
// content-left edge and auto-tracks collapse + responsive layout. 0 if no shell.
function contentLeft() {
  const mc = document.querySelector(".main-content");
  if (!mc) return 0;
  const left = Math.round(mc.getBoundingClientRect().left);
  return left > 0 ? left : 0;
}

function refreshOffsets() {
  const root = document.documentElement;
  root.style.setProperty("--hga-cl-left", contentLeft() + "px");
  root.style.setProperty("--hga-cl-top", HEADER_H + "px");
}

function applyGlass(el) {
  if (!isScrim(el)) return false;
  refreshOffsets();
  el.classList.add("hga-glass");
  const z = parseFloat(getComputedStyle(el).zIndex) || 0;
  // normal popups get the sidebar-excluding inset; system blockers stay full-screen
  if (z < SYSTEM_Z && contentLeft() > 0) el.classList.add("hga-glass-inset");
  return true;
}

function scan(node) {
  if (!node || node.nodeType !== 1) return;
  // the scrim is usually the added node itself, or a descendant with inline `fixed`
  applyGlass(node);
  const cands = node.querySelectorAll && node.querySelectorAll('[style*="fixed"]');
  if (cands) cands.forEach(applyGlass);
}

export default function GlassBackdrop({ collapsed }) {
  useEffect(() => {
    // catch any modal already mounted at first paint
    scan(document.body);

    const observer = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) scan(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // keep the inset tracking window resize while a modal is open
    const onResize = () => {
      if (document.querySelector(".hga-glass")) refreshOffsets();
    };
    window.addEventListener("resize", onResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // sidebar collapse/expand (260↔64px, 250ms) while a modal is open: re-measure so
  // the frost's left edge glides with it (.hga-glass-inset carries a matching transition).
  useEffect(() => {
    if (!document.querySelector(".hga-glass-inset")) return;
    refreshOffsets();
    const t = setTimeout(refreshOffsets, 280); // re-read after the width animation settles
    return () => clearTimeout(t);
  }, [collapsed]);

  return null;
}
