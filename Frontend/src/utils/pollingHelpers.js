/**
 * pollingHelpers.js — visibility-aware polling + input debounce hooks.
 *
 * R7bh-F9 / R7bg-9-HIGH-4
 * --------------------------------------------------------------------
 * Every `setInterval` poll in HIS used to fire 24/7 regardless of
 * whether the tab was visible — a Pharmacist who tabbed away to email
 * for an hour would still have the indent queue, dashboard KPIs and
 * sales lists hammering the server every 10-60 s. On a 30-tab kiosk
 * day (Pharmacy + Accounts + Reception + Ward) that's 2-3 thousand
 * background requests per user-hour, with proportional battery /
 * bandwidth / DB load.
 *
 * `useVisiblePoll(fn, ms, deps)` swaps in for the manual
 * `setInterval` + `clearInterval` boilerplate and gates the tick on
 * `document.visibilityState === "visible"`. When the tab goes
 * hidden, the interval stops; on visible it fires immediately
 * (refresh-on-focus) and restarts the cadence. Cleanup is automatic.
 *
 * `useDebounce(value, ms)` is the standard "wait until the user
 * stops typing" helper — used by search-as-you-type inputs to avoid
 * one /pharmacy/drugs?q=… request per keystroke (R7bg-4-HIGH-1).
 */
import { useEffect, useRef, useState } from "react";

/**
 * Visibility-gated polling. Fires `fn` every `ms` ms when document is
 * visible. Pauses on visibility hidden, resumes on visible (and
 * immediately invokes `fn` once on the visible transition so the user
 * sees fresh data when they tab back in).
 *
 * Usage:
 *   useVisiblePoll(load, 10_000, [filterStatus, filterUrgency]);
 *
 * `fn` is captured by ref so identity changes between renders don't
 * tear down/re-create the interval — only `ms` and `deps` re-arm it.
 */
export function useVisiblePoll(fn, ms, deps = []) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);

  useEffect(() => {
    let timer = null;
    const tick = () => {
      if (document.visibilityState === "visible") {
        try { fnRef.current(); } catch (_) { /* swallow — caller already handles its own errors */ }
      }
    };
    const start = () => {
      if (timer) return;
      timer = setInterval(tick, ms);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        // immediate refresh on tab focus + (re)start polling
        try { fnRef.current(); } catch (_) {}
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
    // ms + deps are the only legitimate re-arm triggers; fn is captured by ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}

/**
 * Debounce hook for search-as-you-type. Returns the value debounced by
 * `ms` milliseconds — useful when wiring an `<input value={q}>` to a
 * fetch effect: depend on `useDebounce(q, 300)` instead of `q` and
 * the network request only fires after the user pauses typing.
 *
 * Usage:
 *   const [q, setQ] = useState("");
 *   const debouncedQ = useDebounce(q, 300);
 *   useEffect(() => { fetchSomething(debouncedQ); }, [debouncedQ]);
 */
export function useDebounce(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
