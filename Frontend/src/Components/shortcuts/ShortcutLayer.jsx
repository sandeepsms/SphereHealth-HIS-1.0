// Components/shortcuts/ShortcutLayer.jsx
// ════════════════════════════════════════════════════════════════════
// R7hr-223 — single mount point for the keyboard shortcut layer. Mounted
// once inside the authenticated app shell (App.jsx AppLayout). Reads the
// current role, builds the role-filtered command list + chord map, wires
// the keydown engine to the palette / cheat-sheet, and implements the
// "smart action keys" (Ctrl+S / Ctrl+P / Ctrl+N) as a best-effort click of
// the current page's primary button — WITHOUT editing any page.
// ════════════════════════════════════════════════════════════════════
import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useGlobalShortcuts from "../../hooks/useGlobalShortcuts";
import { commandsForRole, chordMapForRole } from "../../config/shortcuts";
import CommandPalette from "./CommandPalette";
import ShortcutCheatSheet from "./ShortcutCheatSheet";
import "./shortcuts.css";

// Find the page's primary action button by visible label, scoped to the
// main content region (never the header, sidebar, or our own overlays).
// Returns the button's label if clicked, else null.
function clickPrimary(patterns) {
  const root = document.querySelector(".main-content") || document.body;
  const cands = Array.from(root.querySelectorAll('button, [role="button"], input[type="submit"]')).filter((el) => {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    if (el.closest(".sx-overlay")) return false; // never our palette/cheat-sheet
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;           // visible
  });
  const textOf = (el) => (el.value || el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
  for (const re of patterns) {
    const hit = cands.find((el) => re.test(textOf(el)));
    if (hit) { hit.click(); return textOf(hit).slice(0, 40); }
  }
  return null;
}

const SAVE_PATTERNS  = [/^(save|submit|sign|finali[sz]e|update|confirm)\b/i];
const PRINT_PATTERNS = [/\bprint\b/i];
const NEW_PATTERNS   = [/^(new|add|create|register|raise)\b/i, /^\+$/];

export default function ShortcutLayer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role || "";

  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [chordOn, setChordOn] = useState(false);

  const commands = commandsForRole(role);
  const chordMap = chordMapForRole(role);

  // Tiny transient hint, no dependency on the app toast system.
  const flash = useCallback((msg) => {
    const el = document.createElement("div");
    el.className = "sx-flash";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("sx-flash--out"), 950);
    setTimeout(() => el.remove(), 1350);
  }, []);

  useGlobalShortcuts({
    onPalette: () => { setHelp(false); setPalette(true); },
    onHelp:    () => { setPalette(false); setHelp(true); },
    onHome:    () => navigate("/dashboard"),
    onBack:    () => window.history.back(),
    onEscape:  () => { setPalette(false); setHelp(false); },
    onSave: () => { const t = clickPrimary(SAVE_PATTERNS); flash(t ? `▶ ${t}` : "No Save button on this page"); },
    onPrint: () => { const t = clickPrimary(PRINT_PATTERNS); if (t) { flash(`🖨 ${t}`); return true; } return false; },
    onNew:  () => { const t = clickPrimary(NEW_PATTERNS); flash(t ? `▶ ${t}` : "No New / Add button here"); },
    onChord: (k) => { const c = chordMap[k]; if (c) navigate(c.path); else flash(`No shortcut: G ${k.toUpperCase()}`); },
    onChordChange: setChordOn,
  });

  if (!role) return null;

  return (
    <>
      {chordOn && <div className="sx-chord-hint"><kbd>G</kbd> …</div>}
      {palette && (
        <CommandPalette
          commands={commands}
          onClose={() => setPalette(false)}
          onPick={(path) => { setPalette(false); navigate(path); }}
        />
      )}
      {help && <ShortcutCheatSheet role={role} chordMap={chordMap} onClose={() => setHelp(false)} />}
    </>
  );
}
