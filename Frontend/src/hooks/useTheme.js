import { useEffect, useState, useCallback } from "react";

/**
 * useTheme — light / dark toggle backed by localStorage and reflected on
 * <html data-theme>. CSS uses [data-theme=dark] overrides on --pf-* vars.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("pf-theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("pf-theme", theme); } catch {}
  }, [theme]);
  const toggle = useCallback(() => setTheme(t => t === "dark" ? "light" : "dark"), []);
  return { theme, setTheme, toggle };
}
