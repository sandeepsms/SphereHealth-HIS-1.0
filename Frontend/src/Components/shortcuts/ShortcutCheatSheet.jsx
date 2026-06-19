// Components/shortcuts/ShortcutCheatSheet.jsx
// R7hr-223 — ?/F1 overlay. Shows the general keys + the role's quick-nav
// chords (so it is both role-aware and self-documenting).
import { GLOBAL_SHORTCUTS } from "../../config/shortcuts";

function Keys({ keys }) {
  return <span className="sx-keys">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>;
}

export default function ShortcutCheatSheet({ role, chordMap, onClose }) {
  const chords = Object.entries(chordMap); // [[chordChar, command], …]
  return (
    <div className="sx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sx-sheet" role="dialog" aria-label="Keyboard shortcuts" aria-modal="true">
        <div className="sx-sheet-head">
          <div><strong>Keyboard shortcuts</strong> <span className="sx-role">· {role}</span></div>
          <button className="sx-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sx-sheet-body">
          <div className="sx-sheet-col">
            <div className="sx-sheet-h">General</div>
            {GLOBAL_SHORTCUTS.map((s, i) => (
              <div className="sx-sheet-row" key={i}><Keys keys={s.keys} /><span>{s.label}</span></div>
            ))}
          </div>
          <div className="sx-sheet-col">
            <div className="sx-sheet-h">Quick nav — press <kbd>G</kbd> then…</div>
            {chords.length === 0 && (
              <div className="sx-sheet-row sx-muted"><span>No quick-nav keys for your role — use <kbd>Ctrl</kbd><kbd>K</kbd></span></div>
            )}
            {chords.map(([k, c]) => (
              <div className="sx-sheet-row" key={k}>
                <span className="sx-keys"><kbd>G</kbd><kbd>{k.toUpperCase()}</kbd></span>
                <span>{c.icon} {c.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="sx-sheet-foot">Tip: press <kbd>Ctrl</kbd><kbd>K</kbd> anywhere to search every page you can open.</div>
      </div>
    </div>
  );
}
