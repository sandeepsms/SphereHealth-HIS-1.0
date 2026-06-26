// Components/anim/GlobalClickFx.jsx
// R7hr-278 (USER): app-wide Ripple Click effect — every button/link/role=button
// click spawns a Material-style ripple at the cursor. Like PrintCelebrate, this
// is a single global capture-phase observer (edits NO page) that only OBSERVES
// (no preventDefault), draws on a fixed pointer-events:none overlay, honours
// prefers-reduced-motion, and is hidden in @media print.
import { useEffect } from "react";

let host = null;
function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.className = "click-fx-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99998;overflow:hidden;";
  document.body.appendChild(host);
  return host;
}

function ripple(x, y, size) {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const h = ensureHost();
  // R7hr-282 (USER): radius halved (size/2, clamp 18–80) + faded further (.28/.10 → .18/.06)
  const d = Math.max(18, Math.min(80, size / 2));
  const s = document.createElement("span");
  s.style.cssText =
    `position:absolute;left:${x - d / 2}px;top:${y - d / 2}px;width:${d}px;height:${d}px;` +
    "border-radius:50%;background:radial-gradient(circle, rgba(37,99,235,.18), rgba(37,99,235,.06) 60%, transparent 72%);" +
    "transform:scale(0);opacity:1;will-change:transform,opacity;";
  h.appendChild(s);
  requestAnimationFrame(() => {
    s.style.transition = "transform .5s cubic-bezier(.2,.7,.3,1), opacity .55s ease-out";
    s.style.transform = "scale(2.2)";
    s.style.opacity = "0";
  });
  setTimeout(() => s.remove(), 600);
}

export default function GlobalClickFx() {
  useEffect(() => {
    const onClick = (e) => {
      const el = e.target.closest && e.target.closest('button, a, [role="button"], .p-button, .his-tab, [data-ripple]');
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect();
      // ripple roughly the size of the control, centred on the click point
      ripple(e.clientX, e.clientY, Math.max(r.width, r.height));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
