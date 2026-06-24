// Components/RouteTransition.jsx
// R7hr-273 — global, additive route-change animator. Wraps ONLY the
// authenticated <Routes> outlet in App.jsx's main shell. Re-fires the
// .hga-route entrance on every pathname change by keying a wrapper <div>
// on location.pathname.
//
// It is NOT mounted on the /print/*, patient-file-print, or /login branches —
// those return from AppLayout BEFORE the main shell, so they never reach this.
// All motion is disabled via CSS under prefers-reduced-motion + @media print.
import { useLocation } from "react-router-dom";

export default function RouteTransition({ children }) {
  const location = useLocation();
  // key on pathname only (not search) → one clean animation per navigation,
  // not on every query-string tweak (filters, ?mode=print, etc.).
  return (
    <div key={location.pathname} className="hga-route">
      {children}
    </div>
  );
}
