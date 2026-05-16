/**
 * useSavedPreset — Roadmap G25.
 *
 * Persists a slice of UI state (active tab, filter selections, etc.)
 * keyed by `(role, presetName)` in localStorage so a user's last view
 * of the panel reopens with the same tab/filter combination.
 *
 * Returns [state, setState] tuple identical to useState; updates write
 * to localStorage debounced to 300ms.
 */
import { useEffect, useState, useRef } from "react";

const STORAGE_PREFIX = "pf-preset:";

export function useSavedPreset(key, initial) {
  const fullKey = STORAGE_PREFIX + key;
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw) return { ...initial, ...JSON.parse(raw) };
    } catch {}
    return initial;
  });
  const writeT = useRef(null);
  useEffect(() => {
    clearTimeout(writeT.current);
    writeT.current = setTimeout(() => {
      try { localStorage.setItem(fullKey, JSON.stringify(state)); } catch {}
    }, 300);
    return () => clearTimeout(writeT.current);
  }, [fullKey, state]);
  return [state, setState];
}
