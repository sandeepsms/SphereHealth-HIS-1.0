// Components/anim/AnimKit.jsx
// R7hr-274 — premium animation effects toolkit. Reusable, opt-in components used
// by the Animation Gallery and wireable into any non-frozen surface. Importing
// this module also ships animKit.css. Pure React + CSS (no new dependency).
import React, { useEffect, useRef, useState, useCallback } from "react";
import "./animKit.css";

const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* 01 — Animated Counter (counts up to `value` on mount / when value changes) */
export function AnimatedCounter({ value = 0, duration = 1200, decimals = 0, prefix = "", suffix = "", className = "" }) {
  const [disp, setDisp] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const end = Number(value) || 0;
    if (prefersReduced()) { setDisp(end); return; }
    const start = performance.now(); const from = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisp(from + (end - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <span className={`ak-counter ${className}`}>{prefix}{disp.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

/* 12 — Typewriter Text */
export function Typewriter({ text = "", speed = 45, className = "", loop = false }) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (prefersReduced()) { setOut(text); return; }
    let i = 0, alive = true, timer;
    const step = () => {
      if (!alive) return;
      setOut(text.slice(0, i));
      if (i <= text.length) { i++; timer = setTimeout(step, speed); }
      else if (loop) { i = 0; timer = setTimeout(step, 1400); }
    };
    step();
    return () => { alive = false; clearTimeout(timer); };
  }, [text, speed, loop]);
  return <span className={className}>{out}<span style={{ opacity: out.length < text.length ? 1 : 0, fontWeight: 400 }}>▍</span></span>;
}

/* 17 — Circular Progress Ring (SVG) */
export function CircularRing({ value = 0, size = 84, stroke = 9, color = "#4f46e5", track = "#e7edf5", label }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const [off, setOff] = useState(circ);
  useEffect(() => {
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    const target = circ * (1 - pct / 100);
    if (prefersReduced()) { setOff(target); return; }
    const id = requestAnimationFrame(() => setOff(target));
    return () => cancelAnimationFrame(id);
  }, [value, circ]);
  return (
    <svg className="ak-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle className="ak-ring-arc" cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size*0.24} fontWeight="800" fill="#0f172a">
        {label != null ? label : `${Math.round(value)}%`}
      </text>
    </svg>
  );
}

/* 09 — Ripple button/wrapper. Spreads ink from the click point. */
export function RippleButton({ as = "button", className = "", children, onClick, style, ...rest }) {
  const ref = useRef(null);
  const handle = useCallback((e) => {
    const el = ref.current; if (el && !prefersReduced()) {
      const rect = el.getBoundingClientRect();
      const d = Math.max(rect.width, rect.height);
      const ink = document.createElement("span");
      ink.className = "ak-ink";
      ink.style.width = ink.style.height = `${d}px`;
      ink.style.left = `${e.clientX - rect.left - d/2}px`;
      ink.style.top  = `${e.clientY - rect.top  - d/2}px`;
      el.appendChild(ink);
      setTimeout(() => ink.remove(), 650);
    }
    onClick && onClick(e);
  }, [onClick]);
  const Tag = as;
  return <Tag ref={ref} className={`ak-ripple ${className}`} onClick={handle} style={style} {...rest}>{children}</Tag>;
}

/* 20 — Particle Burst (fires confetti particles from the element on trigger) */
export function ParticleBurst({ children, count = 18, colors = ["#4f46e5","#db2777","#16a34a","#f59e0b","#7c3aed"], className = "", ...rest }) {
  const ref = useRef(null);
  const fire = useCallback(() => {
    const el = ref.current; if (!el || prefersReduced()) return;
    const rect = el.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "ak-particle";
      p.style.background = colors[i % colors.length];
      p.style.left = `${rect.width / 2}px`;
      p.style.top = `${rect.height / 2}px`;
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 40 + Math.random() * 60;
      p.style.setProperty("--bx", `${Math.cos(ang) * dist}px`);
      p.style.setProperty("--by", `${Math.sin(ang) * dist}px`);
      p.style.animation = `ak-burst-fly ${600 + Math.random()*400}ms cubic-bezier(.2,.7,.3,1) forwards`;
      el.appendChild(p);
      setTimeout(() => p.remove(), 1100);
    }
  }, [count, colors]);
  return <span ref={ref} className={`ak-burst ${className}`} onClick={fire} {...rest}>{children}</span>;
}

/* 05 — Morphing Save Button (idle → saving → saved) */
export function MorphSaveButton({ label = "Save", onSave, className = "", style }) {
  const [state, setState] = useState("idle");
  const click = async () => {
    if (state !== "idle") return;
    setState("saving");
    try { await (onSave ? onSave() : new Promise(r => setTimeout(r, 1100))); } catch { /* noop */ }
    setState("saved");
    setTimeout(() => setState("idle"), 1600);
  };
  return (
    <button onClick={click} className={`ak-save ${state === "saving" ? "is-saving" : ""} ${state === "saved" ? "is-saved" : ""} ${className}`}
      style={{ color: "#fff", border: "none", borderRadius: state === "saving" ? 99 : 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer", background: state === "idle" ? "#1e293b" : undefined, minWidth: 120, ...style }}>
      {state === "idle" && label}
      {state === "saving" && <span className="ak-spinner" style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "ak-spin .7s linear infinite" }} />}
      {state === "saved" && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg className="ak-check" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5L20 6" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Saved
        </span>
      )}
    </button>
  );
}

/* 14 — Bell Shake + Badge */
export function BellBadge({ count = 0 }) {
  const [ring, setRing] = useState(false);
  const [n, setN] = useState(count);
  useEffect(() => { setN(count); }, [count]);
  const ding = () => { setRing(false); requestAnimationFrame(() => setRing(true)); setTimeout(() => setRing(false), 950); setN(x => x + 1); };
  return (
    <button onClick={ding} title="Ring" style={{ position: "relative", background: "transparent", border: "none", cursor: "pointer", fontSize: 24, lineHeight: 1 }}>
      <span className={ring ? "ak-bell is-ringing" : "ak-bell"} style={{ display: "inline-block" }}>🔔</span>
      {n > 0 && <span key={n} className="ak-badge" style={{ position: "absolute", top: -4, right: -6, background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 800, minWidth: 16, height: 16, borderRadius: 99, display: "grid", placeItems: "center", padding: "0 4px" }}>{n}</span>}
    </button>
  );
}

/* 15 — Patient Journey Steps */
export function JourneySteps({ steps = ["Registered","Triaged","Consulted","Admitted","Discharged"], current = 2 }) {
  return (
    <div className="ak-steps">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span className="ak-step-dot" style={{ background: i <= current ? "#4f46e5" : "#cbd5e1", animationDelay: `${i * 0.12}s` }}>{i < current ? "✓" : i + 1}</span>
            <span style={{ fontSize: 10, color: i <= current ? "#1e293b" : "#94a3b8", fontWeight: i === current ? 700 : 500 }}>{s}</span>
          </div>
          {i < steps.length - 1 && <div className="ak-step-line"><i style={{ animationDelay: `${i * 0.12 + 0.1}s`, width: i < current ? "100%" : 0 }} /></div>}
        </React.Fragment>
      ))}
    </div>
  );
}

/* 06 — Vitals Progress Bar (animates width on mount) */
export function VitalsBar({ value = 0, max = 100, color = "#4f46e5", live = false, height = 10 }) {
  const [w, setW] = useState(0);
  useEffect(() => { const id = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, (value/max)*100)))); return () => cancelAnimationFrame(id); }, [value, max]);
  return <div className={`ak-bar ${live ? "is-live" : ""}`} style={{ height }}><i style={{ width: `${w}%`, background: color }} /></div>;
}

/* 18 — Live Ticker */
export function Ticker({ items = [], sep = "  •  ", className = "", style }) {
  const text = items.join(sep);
  return <div className={`ak-ticker ${className}`} style={style}><span>{text}{sep}{text}</span></div>;
}

/* 19 — Glitch Text */
export function GlitchText({ text = "", style, className = "" }) {
  return <span className={`ak-glitch ${className}`} data-text={text} style={style}>{text}</span>;
}

/* 13 — Rotating Gradient Border wrapper */
export function GradientBorder({ children, style }) {
  return <div className="ak-gradborder" style={style}><div style={{ padding: 16 }}>{children}</div></div>;
}

/* 04 — 3D Card Flip (hover or controlled via `flipped`) */
export function FlipCard({ front, back, flipped, height = 130 }) {
  return (
    <div className={`ak-flip ${flipped ? "is-flipped" : ""}`} style={{ height }}>
      <div className="ak-flip-inner">
        <div className="ak-flip-face" style={{ background: "#eef2ff", border: "1px solid #c7d2fe" }}>{front}</div>
        <div className="ak-flip-face ak-flip-back" style={{ background: "#1e293b", color: "#fff" }}>{back}</div>
      </div>
    </div>
  );
}

export default {
  AnimatedCounter, Typewriter, CircularRing, RippleButton, ParticleBurst,
  MorphSaveButton, BellBadge, JourneySteps, VitalsBar, Ticker, GlitchText,
  GradientBorder, FlipCard,
};
