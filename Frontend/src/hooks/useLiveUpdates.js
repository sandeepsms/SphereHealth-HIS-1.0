/**
 * useLiveUpdates — Roadmap E20.
 *
 * Subscribes to the patient's Server-Sent Events feed
 * (/api/live-updates/:uhid). Calls `onActivity(payload)` whenever a
 * new audit row is broadcast. Reconnects with backoff on disconnect.
 *
 * Browser EventSource doesn't support custom headers, so this only
 * works against cookie-auth or unauthenticated channels. The backend
 * route runs under the same `authenticate` middleware which trusts
 * the access-token cookie that the SPA already sets at login.
 */
import { useEffect, useRef } from "react";
import { API_ENDPOINTS } from "../config/api";

export function useLiveUpdates(uhid, onActivity) {
  const cbRef = useRef(onActivity);
  cbRef.current = onActivity;

  useEffect(() => {
    if (!uhid) return;
    let es = null;
    let cancelled = false;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      try {
        es = new EventSource(`${API_ENDPOINTS.BASE}/live-updates/${encodeURIComponent(uhid)}`, { withCredentials: true });
        es.addEventListener("activity", (ev) => {
          try { cbRef.current?.(JSON.parse(ev.data)); } catch {}
        });
        es.onopen = () => { attempt = 0; };
        es.onerror = () => {
          es?.close();
          if (cancelled) return;
          // Exponential backoff capped at 30s
          const delay = Math.min(30_000, 1000 * Math.pow(2, attempt++));
          setTimeout(connect, delay);
        };
      } catch (e) {
        // EventSource not supported (very old browser) — silently skip.
      }
    };
    connect();
    return () => { cancelled = true; es?.close(); };
  }, [uhid]);
}
