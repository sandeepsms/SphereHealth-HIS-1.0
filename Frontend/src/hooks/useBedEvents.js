// hooks/useBedEvents.js
// Subscribe to the bed event stream (Server-Sent Events) — fires
// the supplied callback whenever the backend emits a "bed-update"
// event. Used by BedVisualLayout and BedDashboard so the UI
// refreshes the moment another user (or the system) touches a bed.

import { useEffect, useRef } from "react";
import { API_ENDPOINTS } from "../config/api";

const ENDPOINT = `${API_ENDPOINTS.BEDS}/events`;

/**
 * @param {Function} onUpdate  invoked with the parsed event payload
 * @param {Object}   options
 * @param {Boolean}  options.enabled  set false to pause the subscription
 */
export default function useBedEvents(onUpdate, { enabled = true } = {}) {
  // Hold the latest callback in a ref so we don't rebind the
  // EventSource every render — that would cause reconnect loops.
  const cbRef = useRef(onUpdate);
  cbRef.current = onUpdate;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;

    let es;
    try {
      es = new EventSource(ENDPOINT);
    } catch (_) {
      return;
    }

    const handle = (e) => {
      let data = null;
      try { data = e.data ? JSON.parse(e.data) : null; } catch (_) { /* ignore */ }
      cbRef.current?.(data, e.type);
    };
    es.addEventListener("bed-update", handle);

    // Surface connection failures quietly — EventSource auto-reconnects,
    // so we don't need to re-create the connection ourselves.
    es.onerror = () => { /* swallow; browser retries */ };

    return () => {
      try { es.removeEventListener("bed-update", handle); } catch (_) {}
      try { es.close(); } catch (_) {}
    };
  }, [enabled]);
}
