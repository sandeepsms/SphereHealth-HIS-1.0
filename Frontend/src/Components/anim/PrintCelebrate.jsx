// Components/anim/PrintCelebrate.jsx
// R7hr-277 (USER): fire a particle burst from ANY print button, app-wide.
//
// A single global click observer (capture phase) — it never edits a page. When a
// clicked element is a "print" control (a pi-print/ti-printer icon, a label/title/
// text with the standalone word "print", or the 🖨 glyph) it spawns a confetti
// burst at the click point on a fixed, pointer-events:none overlay on document.body.
// It only OBSERVES (no preventDefault), so the real print action still runs, and
// the overlay is hidden in @media print (rule in animations.css) so it never lands
// on a printout. "Fingerprint" is NOT matched (word-boundary regex).
import { useEffect } from "react";

const COLORS = ["#4f46e5", "#db2777", "#16a34a", "#f59e0b", "#7c3aed", "#06b6d4", "#ef4444", "#0ea5e9"];

function isPrintControl(el) {
  if (!el || !el.querySelector) return false;
  if (el.querySelector(".pi-print, .ti-printer, .pi-print-circle")) return true;
  const txt = (el.textContent || "").trim();
  if (/\u{1F5A8}/u.test(txt)) return true;                 // 🖨 printer glyph
  if (txt.length <= 48 && /\bprint\b/i.test(txt)) return true;
  const meta = `${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`;
  if (/\bprint\b/i.test(meta)) return true;
  return false;
}

let host = null;
function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.className = "print-burst-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden;";
  document.body.appendChild(host);
  return host;
}

function burst(x, y) {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const h = ensureHost();
  const parts = [];
  for (let i = 0; i < 32; i++) {
    const el = document.createElement("span");
    const s = 6 + Math.random() * 9, circle = Math.random() < 0.4;
    el.style.cssText = `position:absolute;left:0;top:0;width:${s.toFixed(1)}px;height:${(circle ? s : s * 0.5).toFixed(1)}px;background:${COLORS[i % COLORS.length]};border-radius:${circle ? "50%" : "2px"};will-change:transform,opacity;`;
    h.appendChild(el);
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6, spd = 5 + Math.random() * 9;
    parts.push({ el, x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, rot: Math.random() * 360, vrot: (Math.random() - 0.5) * 26, life: 1, fade: 0.011 + Math.random() * 0.012 });
  }
  const tick = () => {
    let alive = 0;
    for (const p of parts) {
      if (!p.el) continue;
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vrot; p.life -= p.fade;
      if (p.life <= 0 || p.y > window.innerHeight + 60) { p.el.remove(); p.el = null; continue; }
      alive++;
      p.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) rotate(${p.rot.toFixed(0)}deg)`;
      p.el.style.opacity = Math.max(0, p.life).toFixed(2);
    }
    if (alive > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export default function PrintCelebrate() {
  useEffect(() => {
    const onClick = (e) => {
      const btn = e.target.closest && e.target.closest('button, a, [role="button"], .p-button');
      if (btn && isPrintControl(btn)) burst(e.clientX, e.clientY);
    };
    // capture phase: observe before the button's own handler; never preventDefault.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
