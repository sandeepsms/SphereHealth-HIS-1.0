// hooks/useGlobalShortcuts.js
// ════════════════════════════════════════════════════════════════════
// R7hr-223 — single window-level keydown engine for the app-wide shortcut
// layer. Pure behaviour, no UI. Calls back into ShortcutLayer.
//
// Design notes:
//   • Modifier combos (Ctrl/Cmd + K/S/P/N) fire even while a field is
//     focused — that is the Windows-app expectation.
//   • Plain single-key chords (G then …) and "?" are SUPPRESSED while the
//     user is typing in an input / textarea / select / contenteditable, so
//     we never hijack literal typing.
//   • We only preventDefault on keys we actually own, so existing page
//     handlers (e.g. "/" to focus a local search) keep working.
//   • No Ctrl+S/P/N is bound anywhere else in the app (verified), so there
//     is no double-trigger risk.
// ════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export default function useGlobalShortcuts(handlers) {
  const h = useRef(handlers);
  h.current = handlers;
  const chord = useRef({ active: false, timer: null });

  useEffect(() => {
    const clearChord = () => {
      chord.current.active = false;
      if (chord.current.timer) { clearTimeout(chord.current.timer); chord.current.timer = null; }
      h.current.onChordChange?.(false);
    };

    const onKey = (e) => {
      const H = h.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;

      // ── Modifier combos (fire even while typing) ──────────────────
      if (mod && !e.altKey && !e.shiftKey && lower === "k") { e.preventDefault(); clearChord(); H.onPalette?.(); return; }
      if (mod && !e.altKey && lower === "s") { e.preventDefault(); H.onSave?.(); return; }
      if (mod && !e.altKey && lower === "p") { if (H.onPrint?.()) e.preventDefault(); return; }
      if (mod && !e.altKey && lower === "n") { e.preventDefault(); H.onNew?.(); return; }

      // ── Alt navigation ───────────────────────────────────────────
      if (e.altKey && !mod && lower === "h") { e.preventDefault(); clearChord(); H.onHome?.(); return; }
      if (e.altKey && !mod && key === "ArrowLeft") { e.preventDefault(); H.onBack?.(); return; }

      // ── Help (F1 always; "?" only when not typing) ───────────────
      if (key === "F1") { e.preventDefault(); clearChord(); H.onHelp?.(); return; }
      if (key === "?" && !mod && !e.altKey && !isTyping(e.target)) { e.preventDefault(); clearChord(); H.onHelp?.(); return; }

      // ── Escape — close overlays (do not preventDefault so page/modal
      //    Esc handlers still run) ─────────────────────────────────────
      if (key === "Escape") { if (chord.current.active) clearChord(); H.onEscape?.(); return; }

      // ── Plain-key chords: never while typing or with a modifier ──
      if (isTyping(e.target) || mod || e.altKey) return;

      if (chord.current.active) {
        const second = lower;
        clearChord();
        if (/^[a-z0-9]$/.test(second)) { e.preventDefault(); H.onChord?.(second); }
        return;
      }
      if (lower === "g") {
        e.preventDefault();
        chord.current.active = true;
        H.onChordChange?.(true);
        chord.current.timer = setTimeout(clearChord, 1500);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (chord.current.timer) clearTimeout(chord.current.timer);
    };
  }, []);
}
