// Components/shortcuts/CommandPalette.jsx
// R7hr-223 — Ctrl+K palette. Receives a role-filtered command list; pure
// launcher (navigates to a path). No app state touched.
import { useState, useEffect, useRef, useMemo } from "react";

export default function CommandPalette({ commands, onClose, onPick }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) =>
      (c.label + " " + (c.keywords || "") + " " + c.path).toLowerCase().includes(s));
  }, [q, commands]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = results[sel]; if (c) onPick(c.path); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="sx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sx-palette" role="dialog" aria-label="Command palette" aria-modal="true">
        <input
          ref={inputRef}
          className="sx-palette-input"
          placeholder="Jump to…  type a page name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="sx-palette-list" ref={listRef}>
          {results.length === 0 && <div className="sx-empty">No matching page you can open</div>}
          {results.map((c, i) => (
            <div
              key={c.id}
              data-i={i}
              className={"sx-row" + (i === sel ? " sx-row--sel" : "")}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => { e.preventDefault(); onPick(c.path); }}
            >
              <span className="sx-row-icon">{c.icon}</span>
              <span className="sx-row-label">{c.label}</span>
              {c.chord && <span className="sx-row-chord"><kbd>G</kbd><kbd>{c.chord.toUpperCase()}</kbd></span>}
              <span className="sx-row-path">{c.path}</span>
            </div>
          ))}
        </div>
        <div className="sx-palette-foot"><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</div>
      </div>
    </div>
  );
}
