// Components/clinical/Icd10Picker.jsx
// R7hr(ICD-P1.3) — ICD-10 typeahead. Drop-in replacement for the plain
// code <input>: type a code ("J18") or words ("pneumonia") → coded list
// from the 74k-code CMS master → pick → onPick fills code + official
// description in the parent form (no more hand-typed descriptions).
//
// Deliberately a controlled input: parent keeps owning the code string,
// so existing save/load logic is untouched. If the doctor never picks a
// suggestion, behaviour is identical to the old free-text input.
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

const authHeaders = () => ({ Authorization: `Bearer ${sessionStorage.getItem("his_token")}` });

const Icd10Picker = ({ value, onChange, onPick, placeholder = "Type code or diagnosis…", style, className }) => {
  const [open, setOpen]   = useState(false);
  const [rows, setRows]   = useState([]);
  const [hi, setHi]       = useState(-1);           // highlighted row (keyboard nav)
  const [meta, setMeta]   = useState(null);          // "FY2026 · 74,719 codes"
  const boxRef  = useRef(null);
  const seqRef  = useRef(0);                          // stale-response guard
  const tRef    = useRef(null);                       // debounce timer
  const pickedRef = useRef(false);                    // suppress search right after a pick

  // one-time release meta (shows the coder the data is current)
  useEffect(() => {
    axios.get(`${API_ENDPOINTS.BASE}/icd10/meta`, { headers: authHeaders() })
      .then(r => setMeta(r.data?.data || null)).catch(() => {});
  }, []);

  // close on outside click
  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const search = (q) => {
    const seq = ++seqRef.current;
    axios.get(`${API_ENDPOINTS.BASE}/icd10/search`, { params: { q }, headers: authHeaders() })
      .then(r => {
        if (seq !== seqRef.current) return;           // a newer query answered already
        const data = r.data?.data || [];
        setRows(data); setHi(data.length ? 0 : -1); setOpen(true);
      })
      .catch(() => {});
  };

  const handleChange = (e) => {
    const q = e.target.value;
    onChange?.(q);
    if (pickedRef.current) { pickedRef.current = false; return; }
    clearTimeout(tRef.current);
    if (q.trim().length < 2) { setOpen(false); setRows([]); return; }
    tRef.current = setTimeout(() => search(q.trim()), 250);
  };

  const pick = (row) => {
    pickedRef.current = true;
    setOpen(false); setRows([]);
    onPick?.({ code: row.code, description: row.description });
  };

  const handleKey = (e) => {
    if (!open || !rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hi >= 0) pick(rows[hi]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        value={value || ""}
        onChange={handleChange}
        onKeyDown={handleKey}
        onFocus={() => rows.length && setOpen(true)}
        placeholder={placeholder}
        className={className}
        style={style}
        autoComplete="off"
        spellCheck={false}
      />
      {open && rows.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 60, marginTop: 4,
          background: "#fff", border: "1px solid #cbd5e1", borderRadius: 10,
          boxShadow: "0 12px 28px -8px rgba(15,23,42,.25)", overflow: "hidden", maxHeight: 320, overflowY: "auto",
        }}>
          {rows.map((r, i) => (
            <div
              key={r.raw || r.code}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              onMouseEnter={() => setHi(i)}
              style={{
                display: "flex", gap: 10, alignItems: "baseline", padding: "8px 12px", cursor: "pointer",
                background: i === hi ? "#f5f3ff" : "#fff",
                borderBottom: "1px solid #f1f5f9", fontSize: 13,
              }}
            >
              <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: "#5b21b6", whiteSpace: "nowrap" }}>{r.code}</span>
              <span style={{ color: "#1e293b" }}>{r.description}</span>
            </div>
          ))}
          {meta?.version && (
            <div style={{ padding: "5px 12px", fontSize: 10.5, color: "#94a3b8", background: "#f8fafc" }}>
              ICD-10-CM {meta.version} · {Number(meta.count || 0).toLocaleString("en-IN")} codes
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Icd10Picker;
