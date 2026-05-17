// hooks/useUhidFromLocation.js
//
// PHI-safe UHID resolver for clinical pages. Security audit E-04 found
// that 4 high-traffic pages (MAR, IPD Initial Assessment, Discharge
// Summary, Diabetic Chart) read the patient's UHID from a URL param
// (`?uhid=UH00000001` or `/path/:uhid`). That puts a quasi-PII identifier
// into:
//   - the browser's history bar (visible to the next user on a shared
//     reception terminal)
//   - server access logs (every Express + nginx hop records the URL)
//   - the Referer header sent to any third-party resource the page
//     loads (CDN font, analytics pixel, etc.)
//
// This hook reads the UHID from location.state FIRST (passed via
// `navigate("/mar", { state: { uhid } })`). If it isn't there, it falls
// back to the URL param for backward compatibility (existing bookmarks,
// hand-typed URLs from clinicians) — BUT immediately scrubs the param
// from the URL via `history.replaceState` so the next render's URL bar
// no longer shows it. The page itself keeps working because the UHID
// now lives in component state.
//
// Usage:
//   import { useUhidFromLocation } from "../../hooks/useUhidFromLocation";
//   const uhid = useUhidFromLocation();
//
// To navigate INTO a page using this hook:
//   navigate("/mar", { state: { uhid: patient.UHID } });
//
// Pages that previously did:
//   const { uhid } = useParams();        // legacy /mar/:uhid route
//   const uhid = new URLSearchParams(location.search).get("uhid");
// should switch to this helper.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

export function useUhidFromLocation() {
  const location = useLocation();
  const params   = useParams();

  // Source priority:
  //   1. location.state.uhid  (the new, clean path)
  //   2. ?uhid= query string  (legacy)
  //   3. /:uhid route param   (legacy)
  const initial = useMemo(() => {
    const fromState = location.state && location.state.uhid;
    if (fromState) return String(fromState).toUpperCase();
    const qp = new URLSearchParams(location.search).get("uhid");
    if (qp) return String(qp).toUpperCase();
    if (params.uhid) return String(params.uhid).toUpperCase();
    return "";
  }, [location.state, location.search, params.uhid]);

  const [uhid] = useState(initial);

  // Scrub the URL after the first read if the UHID came from the query
  // string. We do NOT scrub /:uhid route params because that would
  // change the route and trigger re-mount / re-fetch loops. The scrub
  // runs once via empty deps — by the time React commits the next
  // render, the address bar shows the path without ?uhid=.
  useEffect(() => {
    if (!initial) return;
    const qs = new URLSearchParams(location.search);
    if (qs.has("uhid")) {
      qs.delete("uhid");
      const tail = qs.toString();
      const cleanUrl = location.pathname + (tail ? `?${tail}` : "") + location.hash;
      // replaceState (not pushState) so the user's Back button still
      // returns to wherever they came from, not to the un-scrubbed URL.
      try {
        window.history.replaceState(window.history.state, "", cleanUrl);
      } catch {
        // private mode / sandboxed iframe — swallow
      }
    }
    // Intentionally empty deps — we only scrub once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return uhid;
}

export default useUhidFromLocation;
