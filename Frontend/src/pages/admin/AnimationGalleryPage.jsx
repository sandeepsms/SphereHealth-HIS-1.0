// pages/admin/AnimationGalleryPage.jsx
// R7hr-274 — live showcase of the 20 premium effects in the AnimKit toolkit.
// Every effect is demonstrated here; the components are reusable on any
// non-frozen surface. Route: /animation-gallery.
import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import {
  AnimatedCounter, Typewriter, CircularRing, RippleButton, ParticleBurst,
  MorphSaveButton, BellBadge, JourneySteps, VitalsBar, Ticker, GlitchText,
  GradientBorder, FlipCard,
} from "../../Components/anim/AnimKit";

const card = {
  background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 18,
  minHeight: 150, display: "flex", flexDirection: "column", gap: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,.04)",
};
const num = (n) => ({
  position: "absolute", top: 12, right: 14, fontSize: 11, fontWeight: 800,
  color: "#94a3b8", letterSpacing: ".05em",
});
function Cell({ n, title, children }) {
  return (
    <div className="hga-pop" style={{ ...card, position: "relative" }}>
      <span style={num(n)}>{n}</span>
      <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{title}</div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

export default function AnimationGalleryPage() {
  const [skelLoading, setSkelLoading] = useState(true);
  const [flip, setFlip] = useState(false);
  const [modal, setModal] = useState(false);
  const [reseed, setReseed] = useState(0);   // re-trigger counters/bars/rings
  useEffect(() => { const t = setInterval(() => setSkelLoading((s) => !s), 2600); return () => clearInterval(t); }, []);

  const patients = ["Badal Sharma", "Ramesh Kumar", "Sunita Devi", "Imran Ali", "Priya Nair"];

  return (
    <div className="hga-stagger" style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>🎬 Animation Gallery <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>— 20 effects, live</span></h1>
        <button onClick={() => setReseed((x) => x + 1)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 600 }}>↻ Replay</button>
      </div>

      {/* 18 — Live Hospital Ticker (full-width banner) */}
      <div style={{ background: "#0f172a", color: "#e2e8f0", borderRadius: 12, padding: "9px 0", margin: "14px 0 4px" }}>
        <Ticker items={["🟢 ICU occupancy 82%", "🩺 OPD queue: 14 waiting", "💊 Pharmacy: 3 low-stock alerts", "🚑 ER: 2 incoming", "🧪 Lab TAT 38 min", "🛏️ 6 beds free in Ward-B"]} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16, marginTop: 12 }}>

        <Cell n="01" title="🔢 Animated Counter">
          <div key={reseed} style={{ display: "flex", gap: 18, fontSize: 30 }}>
            <span style={{ color: "#2563eb" }}><AnimatedCounter value={1284} /></span>
            <span style={{ color: "#16a34a", fontSize: 22 }}><AnimatedCounter value={97.4} decimals={1} suffix="%" /></span>
          </div>
        </Cell>

        <Cell n="02" title="💀 Skeleton Shimmer">
          {skelLoading ? (
            <div style={{ width: "100%", display: "grid", gap: 8 }}>
              <div className="ak-skeleton" style={{ height: 12, width: "80%" }} />
              <div className="ak-skeleton" style={{ height: 12, width: "60%" }} />
              <div className="ak-skeleton" style={{ height: 12, width: "70%" }} />
            </div>
          ) : <div style={{ color: "#16a34a", fontWeight: 600 }}>✓ Loaded</div>}
        </Cell>

        <Cell n="03" title="🔔 Toast Notifications">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => toast.success("Saved successfully ✓")} style={btn("#16a34a")}>Success</button>
            <button onClick={() => toast.error("Something went wrong")} style={btn("#dc2626")}>Error</button>
            <button onClick={() => toast.info("New lab report ready")} style={btn("#2563eb")}>Info</button>
          </div>
        </Cell>

        <Cell n="04" title="🃏 3D Card Flip">
          <div onMouseEnter={() => setFlip(true)} onMouseLeave={() => setFlip(false)} style={{ width: 170 }}>
            <FlipCard flipped={flip} height={110}
              front={<div style={{ textAlign: "center" }}><div style={{ fontSize: 22 }}>🩺</div><div style={{ fontWeight: 700 }}>Patient Card</div><div style={{ fontSize: 11, color: "#64748b" }}>hover to flip</div></div>}
              back={<div style={{ textAlign: "center" }}><div style={{ fontWeight: 700 }}>UH01 · IPD-26-01</div><div style={{ fontSize: 11, opacity: .8 }}>Ward-B · Bed 4</div></div>} />
          </div>
        </Cell>

        <Cell n="05" title="⚡ Morphing Save Button">
          <MorphSaveButton label="Save Note" />
        </Cell>

        <Cell n="06" title="❤️ Vitals Progress Bars">
          <div key={reseed} style={{ width: "100%", display: "grid", gap: 9 }}>
            <Row lbl="SpO₂ 97%"><VitalsBar value={97} color="#16a34a" /></Row>
            <Row lbl="HR 88 bpm"><VitalsBar value={73} color="#2563eb" live /></Row>
            <Row lbl="Temp 101°F"><VitalsBar value={62} color="#f59e0b" /></Row>
          </div>
        </Cell>

        <Cell n="07" title="🪟 Modal Spring Pop">
          <button onClick={() => setModal(true)} style={btn("#1e293b")}>Open modal</button>
        </Cell>

        <Cell n="08" title="📋 Staggered Patient List">
          <ul className="hga-stagger" style={{ listStyle: "none", margin: 0, padding: 0, width: "100%" }}>
            {patients.map((p) => <li key={p + reseed} style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>👤 {p}</li>)}
          </ul>
        </Cell>

        <Cell n="09" title="💧 Ripple Click Effect">
          <RippleButton style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, padding: "12px 22px", fontWeight: 700, cursor: "pointer" }}>Click me</RippleButton>
        </Cell>

        <Cell n="10" title="🧭 Nav Hover Sweep">
          <div className="ak-sweep" style={{ background: "#1e293b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600 }}>Hover over me →</div>
        </Cell>

        <Cell n="11" title="🎈 Ambient Float">
          <div className="ak-float" style={{ fontSize: 40 }}>🎈</div>
        </Cell>

        <Cell n="12" title="⌨️ Typewriter Text">
          <div key={reseed} style={{ fontFamily: "monospace", fontSize: 14, color: "#0f172a" }}>
            <Typewriter text="Patient stable, vitals within normal range." loop />
          </div>
        </Cell>

        <Cell n="13" title="🌈 Rotating Gradient Border">
          <GradientBorder style={{ width: 150 }}>
            <div style={{ textAlign: "center", fontWeight: 700 }}>NABH ✓<div style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>Accredited</div></div>
          </GradientBorder>
        </Cell>

        <Cell n="14" title="🔔 Bell Shake + Badge">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><BellBadge count={3} /><span style={{ fontSize: 12, color: "#64748b" }}>tap the bell</span></div>
        </Cell>

        <Cell n="15" title="🪜 Patient Journey Steps">
          <div key={reseed} style={{ width: "100%" }}><JourneySteps current={2} /></div>
        </Cell>

        <Cell n="16" title="🃏 Hover Lift Card">
          <div className="ak-lift" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "18px 26px", fontWeight: 700, color: "#1e40af", cursor: "pointer" }}>Hover to lift</div>
        </Cell>

        <Cell n="17" title="⭕ Circular Progress Rings">
          <div key={reseed} style={{ display: "flex", gap: 14 }}>
            <CircularRing value={82} color="#16a34a" />
            <CircularRing value={64} color="#2563eb" />
            <CircularRing value={38} color="#f59e0b" />
          </div>
        </Cell>

        <Cell n="18" title="📰 Live Hospital Ticker">
          <Ticker items={["Bed-7 vacated", "Dr. Mehta on call", "Blood bank: O- low"]} style={{ width: "100%", background: "#f1f5f9", borderRadius: 8, padding: "6px 0" }} />
        </Cell>

        <Cell n="19" title="👾 Glitch Text">
          <GlitchText text="SPHEREHEALTH" style={{ fontSize: 22, fontWeight: 900, letterSpacing: ".05em" }} />
        </Cell>

        <Cell n="20" title="🎉 Particle Burst">
          <ParticleBurst count={22}>
            <button style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10, padding: "12px 22px", fontWeight: 700, cursor: "pointer" }}>🎉 Celebrate</button>
          </ParticleBurst>
        </Cell>
      </div>

      {/* 07 — Modal Spring Pop overlay */}
      {modal && (
        <div className="ak-backdrop" onClick={() => setModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 5000 }}>
          <div className="ak-spring" onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 26, width: 320, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ fontSize: 34 }}>🪟</div>
            <h3 style={{ margin: "8px 0" }}>Modal Spring Pop</h3>
            <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>Springs in with an overshoot bounce.</p>
            <button onClick={() => setModal(false)} style={btn("#2563eb")}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ lbl, children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", alignItems: "center", gap: 8 }}><span style={{ fontSize: 11, color: "#64748b" }}>{lbl}</span>{children}</div>;
}
function btn(bg) {
  return { background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 600, cursor: "pointer", fontSize: 13 };
}
