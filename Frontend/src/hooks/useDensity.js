import { useEffect, useState, useCallback } from "react";

/**
 * useDensity — comfortable vs compact, persisted in localStorage.
 * Sets <html data-density="compact"> when compact, CSS vars swap.
 */
export function useDensity() {
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem("pf-density") || "comfortable"; } catch { return "comfortable"; }
  });
  useEffect(() => {
    if (density === "compact") document.documentElement.setAttribute("data-density", "compact");
    else                       document.documentElement.removeAttribute("data-density");
    try { localStorage.setItem("pf-density", density); } catch {}
  }, [density]);
  const toggle = useCallback(() => setDensity(d => d === "compact" ? "comfortable" : "compact"), []);
  return { density, setDensity, toggle };
}
