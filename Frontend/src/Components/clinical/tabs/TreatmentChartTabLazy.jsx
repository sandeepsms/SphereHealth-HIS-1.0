/**
 * TreatmentChartTabLazy.jsx
 *
 * Canonical example of a lazy-loaded patient-panel tab (Roadmap E17).
 *
 * The actual rendering of the treatment chart already lives in the
 * heavyweight <TreatmentChart> component (Components/clinical/TreatmentChart.jsx,
 * ~85 kB) — we just provide a thin tab-shell wrapper here so the panels
 * can React.lazy() this file. Vite's manualChunks pulls anything under
 * /clinical/tabs/ into the `panel-tabs` chunk, so the heavy TreatmentChart
 * downloads only when the user clicks the Treatment Chart tab.
 *
 * Usage in panel:
 *   const TreatmentChartTab = lazy(() => import("../../Components/clinical/tabs/TreatmentChartTabLazy"));
 *   ...
 *   case "treatment":  return <TreatmentChartTab doctorOrders={doctorOrders} doctorNotes={doctorNotes}/>;
 */

import React from "react";
import TreatmentChart from "../TreatmentChart";

export default function TreatmentChartTabLazy({ doctorOrders = [], doctorNotes = [] }) {
  // TreatmentChart owns its own data fetching, filtering, MAR rendering,
  // and dose-administration UI — we just hand it the upstream orders so
  // it knows which patient to surface.
  return <TreatmentChart doctorOrders={doctorOrders} doctorNotes={doctorNotes} />;
}
