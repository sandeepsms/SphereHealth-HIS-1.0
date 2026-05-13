import { useEffect, useRef, useState, useCallback } from "react";

/**
 * useIdleLock — Roadmap D15.
 *
 * Watches mouse / keyboard / touch activity inside the document; when
 * the user has been idle for `timeoutMs`, returns `locked: true` so the
 * caller can render a full-screen <IdleLockOverlay/>.
 *
 * Tab visibility is included so leaving the tab open in the background
 * still counts as idle. Coming back keeps it locked until the user
 * confirms (overlay calls unlock()).
 *
 * Note: this is a UX lock only — every API call is still JWT-gated on
 * the backend. The lock prevents shoulder-surfing / unattended chart
 * exposure on a shared workstation.
 */
export function useIdleLock(timeoutMs = 10 * 60_000) {
  const [locked, setLocked] = useState(false);
  const lastActivity = useRef(Date.now());

  const reset = useCallback(() => {
    if (!locked) lastActivity.current = Date.now();
  }, [locked]);

  const unlock = useCallback(() => {
    lastActivity.current = Date.now();
    setLocked(false);
  }, []);

  useEffect(() => {
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    const tick = setInterval(() => {
      if (locked) return;
      if (Date.now() - lastActivity.current > timeoutMs) setLocked(true);
    }, 5_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      clearInterval(tick);
    };
  }, [timeoutMs, locked, reset]);

  return { locked, unlock };
}
