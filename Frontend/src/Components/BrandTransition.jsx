/**
 * BrandTransition.jsx — R7hr-330 / R7hr-331
 * Branded transitions between pages with role-specific encouragement.
 *
 *  • BrandSplash        — the visual (animated logo + hospital + line + dots).
 *  • BrandTransition    — Suspense fallback (shown while a lazy chunk loads).
 *  • RouteInterstitial  — overlay that appears the INSTANT a navigation is
 *                         initiated (pushState / back-button), stays while the
 *                         destination's lazy chunk loads underneath, and fades
 *                         once the route commits — so every click gets
 *                         immediate feedback (R7ht).
 *
 * Lines are original, attribution-free encouragements written per role.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useHospitalSettings } from "../context/HospitalSettingsContext";

const ROLE_LINES = {
  Admin: [
    "Steering the whole hospital — lead with clarity.",
    "Every system you keep humming saves someone time.",
    "Mission control is in steady hands.",
  ],
  Doctor: [
    "Every decision you make moves a patient toward healing.",
    "Your expertise turns uncertainty into hope.",
    "One patient at a time — you've got this.",
  ],
  Nurse: [
    "Your care is the heartbeat of every ward.",
    "The smallest kindness you give matters the most.",
    "Steady hands, warm heart — patients feel it.",
  ],
  Receptionist: [
    "You're the first welcome every patient remembers.",
    "A calm front desk calms the whole hospital.",
    "Every smile you give sets the tone for care.",
  ],
  Pharmacist: [
    "Right drug, right dose — your precision protects lives.",
    "Every accurate dispense is quiet heroism.",
    "Safety lives in your attention to detail.",
  ],
  "Lab Technician": [
    "Behind every result is a patient awaiting answers.",
    "Your accuracy guides every diagnosis.",
    "Small samples, big impact.",
  ],
  Radiologist: [
    "You reveal what the eye alone can't see.",
    "Clarity in every image, confidence in every report.",
  ],
  Accountant: [
    "Steady books keep care flowing.",
    "Every figure you balance keeps the wards running.",
  ],
  "TPA Coordinator": [
    "You turn paperwork into peace of mind.",
    "Every claim you clear lifts a family's worry.",
  ],
  Dietician: [
    "Good nutrition is quiet medicine — you prescribe it.",
    "Every plan you build helps someone heal faster.",
  ],
  Physiotherapist: [
    "Every step a patient takes, you helped enable.",
    "Movement is medicine — you deliver it daily.",
  ],
  "Ward Boy": [
    "A ready, clean ward is safe care in motion.",
    "Your work keeps every patient comfortable and safe.",
  ],
  Housekeeping: [
    "A spotless ward is infection-free care in action.",
    "Your work keeps every corner safe.",
  ],
  Security: [
    "Your watch keeps everyone safe.",
    "Calm vigilance protects the whole campus.",
  ],
  MRD: [
    "Every record you safeguard protects a patient's story.",
    "Order today is the answer someone needs tomorrow.",
  ],
  default: [
    "Care, precision, compassion — you bring it every day.",
    "Thank you for the work you do here.",
  ],
};

function pickLine(role) {
  const lines = ROLE_LINES[role] || ROLE_LINES.default;
  return lines[Math.floor(Math.random() * lines.length)];
}

/* ── Shared visual: animated logo + hospital + encouragement + dots ── */
export function BrandSplash({ logo, hospital, line }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ position: "relative", width: 96, height: 96, marginBottom: 22 }}>
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: "3px solid #e0e7ff", borderTopColor: "#4338ca",
          animation: "btSpin .9s linear infinite",
        }} />
        <div style={{
          position: "absolute", inset: 11, borderRadius: "50%", background: "#fff",
          boxShadow: "0 10px 28px rgba(67,56,202,.22)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "btPulse 1.8s ease-in-out infinite",
        }}>
          <img src={logo} alt={hospital}
            style={{ width: "66%", height: "66%", objectFit: "contain" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
        </div>
      </div>

      <div style={{
        fontSize: 11.5, fontWeight: 800, letterSpacing: "1.4px", textTransform: "uppercase",
        color: "#6366f1", marginBottom: 10,
      }}>{hospital}</div>

      <div key={line} style={{
        fontSize: 16.5, fontWeight: 700, color: "#1e293b", maxWidth: 460, lineHeight: 1.5,
        padding: "0 16px", animation: "btRise .5s ease both",
      }}>{line}</div>

      <div style={{ display: "flex", gap: 7, marginTop: 20 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 8, height: 8, borderRadius: "50%", background: "#4338ca",
            animation: "btDot 1.1s ease-in-out infinite", animationDelay: `${i * 0.16}s`,
          }} />
        ))}
      </div>

      <style>{`
        @keyframes btSpin  { to { transform: rotate(360deg); } }
        @keyframes btPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes btRise  { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes btDot   { 0%,100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-4px); } }
        @media (prefers-reduced-motion: reduce) {
          [style*="btSpin"], [style*="btPulse"], [style*="btDot"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ── Suspense fallback — shown while a lazy chunk loads (slow/first visit) ── */
export default function BrandTransition() {
  const { user } = useAuth();
  const { settings } = useHospitalSettings();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 120);
    return () => clearTimeout(t);
  }, []);
  const line = useMemo(() => pickLine(user?.role || "default"), [user?.role]);
  if (!show) return null;
  return (
    <div className="hga-enter-fade" style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "calc(100vh - 140px)", padding: 40,
    }}>
      <BrandSplash logo={settings?.logo || "/bims-logo.png"} hospital={settings?.hospitalName || "Bright Institute of Medical Sciences"} line={line} />
    </div>
  );
}

/* ── Route-change interstitial ───────────────────────────────────────
   R7ht (USER, 2026-07-04) — the splash plays from the INSTANT a navigation
   is initiated, not from when the destination route commits.

   Why: react-router v7 wraps navigation state updates in React.startTransition.
   With lazy() routes the location hooks only update AFTER the destination's JS
   chunk has downloaded — so a splash keyed on useLocation() appeared at the
   END of the dead time (the exact "click → long pause → then the animation"
   complaint).

   Why VANILLA DOM: navigate() calls window.history.pushState synchronously
   inside the click, so patching pushState gives an instant signal — but a
   React-rendered splash proved unreliable: the show-update was observed being
   absorbed into the pending route transition and committing ~1s late (and
   flushSync still misbehaved on the popstate/back path). A plain DOM overlay
   measured 2ms in every case, immune to scheduler lanes, so the splash is
   owned by this module and React only supplies (a) role/hospital config and
   (b) the "route committed" signal that schedules the fade-out. The chunk
   loads UNDER the splash — perceived latency ~0, and the splash absorbs the
   load time instead of adding to it. */

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const navSplash = {
  enabled: false,                 // only while RouteInterstitial (main shell) is mounted
  el: null,
  shownAt: 0,
  lastPath: typeof window !== "undefined" ? window.location.pathname : "/",
  safetyT: null,
  hideT: null,
  role: "default",
  hospital: "Bright Institute of Medical Sciences",
  logo: "/bims-logo.png",
  minShow: 460,                   // brand beat on instant (cached) navigations
  exitMs: 230,
  maxShow: 8000,                  // never trap the user under the overlay

  configure(cfg = {}) {
    if (cfg.role) this.role = cfg.role;
    if (cfg.hospital) this.hospital = cfg.hospital;
    if (cfg.logo) this.logo = cfg.logo;
  },

  visible() { return !!this.el; },

  show() {
    if (!this.enabled || typeof document === "undefined") return;
    clearTimeout(this.hideT); this.hideT = null;
    this.shownAt = Date.now();
    // R7hr(DEFER-20): re-arm the safety timer BEFORE the rapid-double-nav
    // early return. A first nav's hide() clears safetyT; if a second nav
    // fired while the splash was still fading, the early return used to
    // skip the re-arm — a hung chunk then trapped the user under the
    // overlay with no 8s escape.
    clearTimeout(this.safetyT);
    this.safetyT = setTimeout(() => this.hide(0), this.maxShow);
    if (this.el) return;          // rapid double-nav — keep the splash up
    const line = pickLine(this.role);
    const el = document.createElement("div");
    el.id = "bt-nav-splash";
    el.setAttribute("style",
      "position:fixed;inset:0;z-index:6000;display:flex;align-items:center;justify-content:center;" +
      "background:radial-gradient(900px 500px at 50% 8%, #eef2ff, #f8fafc 60%);" +
      "font-family:'DM Sans',sans-serif;animation:btInterIn 140ms ease both");
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
        <div style="position:relative;width:96px;height:96px;margin-bottom:22px">
          <div style="position:absolute;inset:0;border-radius:50%;border:3px solid #e0e7ff;border-top-color:#4338ca;animation:btSpin .9s linear infinite"></div>
          <div style="position:absolute;inset:11px;border-radius:50%;background:#fff;box-shadow:0 10px 28px rgba(67,56,202,.22);display:flex;align-items:center;justify-content:center;animation:btPulse 1.8s ease-in-out infinite">
            <img src="${esc(this.logo)}" alt="" style="width:66%;height:66%;object-fit:contain" onerror="this.style.display='none'" />
          </div>
        </div>
        <div style="font-size:11.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#6366f1;margin-bottom:10px">${esc(this.hospital)}</div>
        <div style="font-size:16.5px;font-weight:700;color:#1e293b;max-width:460px;line-height:1.5;padding:0 16px;animation:btRise .5s ease both">${esc(line)}</div>
        <div style="display:flex;gap:7px;margin-top:20px">
          <span style="width:8px;height:8px;border-radius:50%;background:#4338ca;animation:btDot 1.1s ease-in-out infinite"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#4338ca;animation:btDot 1.1s ease-in-out infinite;animation-delay:.16s"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#4338ca;animation:btDot 1.1s ease-in-out infinite;animation-delay:.32s"></span>
        </div>
      </div>
      <style>
        @keyframes btInterIn   { from { opacity: 0 } to { opacity: 1 } }
        @keyframes btInterExit { from { opacity: 1 } to { opacity: 0 } }
        @keyframes btSpin  { to { transform: rotate(360deg) } }
        @keyframes btPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
        @keyframes btRise  { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @keyframes btDot   { 0%,100% { opacity: .25; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-4px) } }
        @media (prefers-reduced-motion: reduce) { #bt-nav-splash, #bt-nav-splash * { animation: none !important } }
      </style>`;
    document.body.appendChild(el);
    this.el = el;
  },

  // Fade out after honouring the minimum display time.
  hide(minShow = this.minShow) {
    if (!this.el) return;
    clearTimeout(this.safetyT); this.safetyT = null;
    const wait = Math.max(0, minShow - (Date.now() - this.shownAt));
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => {
      const el = this.el;
      if (!el) return;
      el.style.animation = `btInterExit ${this.exitMs}ms ease both`;
      setTimeout(() => { el.remove(); if (this.el === el) this.el = null; }, this.exitMs);
    }, wait);
  },

  removeNow() {
    clearTimeout(this.safetyT); clearTimeout(this.hideT);
    this.safetyT = this.hideT = null;
    this.el?.remove(); this.el = null;
  },

  // Navigation INITIATED (pushState / back-forward) — fires long before the
  // lazy chunk resolves, which is when useLocation() would finally update.
  navStarted(pathname) {
    if (!pathname || pathname === this.lastPath) return;   // query-only / same page
    if (pathname === "/login") return;                     // never over the login screen
    if (pathname.startsWith("/print/")) return;            // print popups own their chrome
    this.show();
  },

  // Navigation COMMITTED (RouteInterstitial saw location.pathname change).
  navCommitted(pathname) {
    this.lastPath = pathname;
    if (pathname === "/login") { this.hide(0); return; }
    if (this.visible()) this.hide();                       // absorb-load path
    else if (this.enabled) { this.show(); this.hide(); }   // replace()-redirects: classic beat
  },
};

function ensureNavSignal() {
  if (typeof window === "undefined") return;
  // R7hr(DEFER-20): the patched pushState survives HMR (window flag) but its
  // closure used to capture THIS module instance's navSplash — after an HMR
  // re-evaluation the patch kept driving the stale object while the fresh
  // RouteInterstitial enabled the new one (dev-only "splash stopped firing").
  // The window-level pointer re-binds to the live instance on every eval.
  window.__btNavSplash = navSplash;
  if (window.__btNavSignalPatched) return;
  window.__btNavSignalPatched = true;   // window flag — survives HMR re-evaluation
  const fire = (url) => {
    try {
      const next = new URL(String(url), window.location.href);
      if (next.origin !== window.location.origin) return;
      (window.__btNavSplash || navSplash).navStarted(next.pathname);
    } catch { /* malformed url — ignore */ }
  };
  const orig = window.history.pushState.bind(window.history);
  window.history.pushState = function patchedPushState(state, title, url) {
    const ret = orig(state, title, url);
    if (url != null) fire(url);
    return ret;
  };
  // replaceState is intentionally NOT wrapped — redirects (<Navigate replace>)
  // and query-param syncing spam it; navCommitted still covers replace-only
  // navigations with the classic splash beat.
  window.addEventListener("popstate", () => fire(window.location.href)); // back / forward
}

/* Thin React side: supplies config + the commit signal; renders nothing. */
export function RouteInterstitial() {
  const location = useLocation();
  const { user } = useAuth();
  const { settings } = useHospitalSettings();
  const lastPathRef = useRef(location.pathname);

  useEffect(() => {
    ensureNavSignal();
    navSplash.enabled = true;
    navSplash.lastPath = window.location.pathname;
    return () => { navSplash.enabled = false; navSplash.removeNow(); };
  }, []);

  useEffect(() => {
    navSplash.configure({
      role: user?.role,
      hospital: settings?.hospitalName,
      logo: settings?.logo,
    });
  }, [user?.role, settings?.hospitalName, settings?.logo]);

  // useLayoutEffect so the fade-out is scheduled before the new page's first paint.
  useLayoutEffect(() => {
    if (location.pathname === lastPathRef.current) return;
    lastPathRef.current = location.pathname;
    navSplash.navCommitted(location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return null;
}
