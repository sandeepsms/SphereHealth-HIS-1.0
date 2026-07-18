// Components/clinical/Icd10Picker.jsx
// R7hr(ICD-P1.3) — ICD-10 typeahead. Drop-in replacement for the plain
// code <input>: type a code ("J18") or words ("pneumonia") → coded list
// from the 74k-code CMS master → pick → onPick fills code + official
// description in the parent form (no more hand-typed descriptions).
//
// The suggestion list is rendered through a PORTAL at <body> with
// position:fixed anchored to the input's rect — so it escapes any parent
// card's `overflow:hidden`/stacking context (an in-card <select>-style
// dropdown was getting clipped by the section below it) and flips above
// the field when there isn't room below.
//
// Deliberately a controlled input: parent keeps owning the code string,
// so existing save/load logic is untouched. If the doctor never picks a
// suggestion, behaviour is identical to the old free-text input.
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

const authHeaders = () => ({ Authorization: `Bearer ${sessionStorage.getItem("his_token")}` });

// R7hr(PCS-P1) — endpoint + footer label are now props (defaults preserve
// the original ICD-10-CM behaviour byte-for-byte) so the same typeahead
// serves the ICD-10-PCS procedure master via <Icd10Picker system="pcs" />.
const SYSTEMS = {
  cm:  { searchPath: "/icd10/search",     metaPath: "/icd10/meta",     label: "ICD-10-CM"  },
  pcs: { searchPath: "/icd10/pcs/search", metaPath: "/icd10/pcs/meta", label: "ICD-10-PCS" },
};

const Icd10Picker = ({ value, onChange, onPick, placeholder = "Type code or diagnosis…", style, className, system = "cm" }) => {
  const sys = SYSTEMS[system] || SYSTEMS.cm;
  const [open, setOpen]   = useState(false);
  const [rows, setRows]   = useState([]);
  const [hi, setHi]       = useState(-1);           // highlighted row (keyboard nav)
  const [meta, setMeta]   = useState(null);          // "FY2026 · 74,719 codes"
  const [pos, setPos]     = useState(null);          // {left,width,top?,bottom?,maxH} — fixed-position anchor
  const inputRef = useRef(null);
  const ddRef    = useRef(null);
  const seqRef   = useRef(0);                          // stale-response guard
  const tRef     = useRef(null);                       // debounce timer
  const pickedRef = useRef(false);                     // suppress search right after a pick

  // one-time release meta (shows the coder the data is current)
  useEffect(() => {
    axios.get(`${API_ENDPOINTS.BASE}${sys.metaPath}`, { headers: authHeaders() })
      .then(r => setMeta(r.data?.data || null)).catch(() => {});
  }, [sys.metaPath]);

  // Anchor the portaled dropdown to the input rect; flip up if the field
  // sits low in the viewport. Recomputed on open + while scrolling/resizing.
  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const below = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    const maxH = Math.max(140, Math.min(300, (below ? spaceBelow : spaceAbove) - 14));
    setPos({
      left: Math.round(r.left),
      width: Math.round(r.width),
      top: below ? Math.round(r.bottom + 4) : undefined,
      bottom: below ? undefined : Math.round(window.innerHeight - r.top + 4),
      maxH,
    });
  }, []);

  // reposition / close on scroll (capture=true catches scrolling containers)
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  // close on outside click — the portaled list lives outside boxRef, so
  // check both the input and the dropdown before closing.
  useEffect(() => {
    const h = (e) => {
      if (inputRef.current?.contains(e.target)) return;
      if (ddRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const search = (q) => {
    const seq = ++seqRef.current;
    axios.get(`${API_ENDPOINTS.BASE}${sys.searchPath}`, { params: { q }, headers: authHeaders() })
      .then(r => {
        if (seq !== seqRef.current) return;           // a newer query answered already
        const data = r.data?.data || [];
        setRows(data); setHi(data.length ? 0 : -1);
        if (data.length) { place(); setOpen(true); } else setOpen(false);
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

  const dropdown = open && rows.length > 0 && pos && createPortal(
    <div
      ref={ddRef}
      style={{
        position: "fixed", left: pos.left, width: pos.width,
        top: pos.top, bottom: pos.bottom, zIndex: 10000,
        background: "#fff", border: "1px solid #c4b5fd", borderRadius: 10,
        boxShadow: "0 16px 36px -10px rgba(15,23,42,.32)", overflowY: "auto", maxHeight: pos.maxH,
      }}
    >
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
          <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: "#5b21b6", whiteSpace: "nowrap", minWidth: 60 }}>{r.code}</span>
          <span style={{ color: "#1e293b" }}>{r.description}</span>
        </div>
      ))}
      {meta?.version && (
        <div style={{ padding: "5px 12px", fontSize: 10.5, color: "#94a3b8", background: "#f8fafc", position: "sticky", bottom: 0 }}>
          {sys.label} {meta.version} · {Number(meta.count || 0).toLocaleString("en-IN")} codes
        </div>
      )}
    </div>,
    document.body,
  );

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={value || ""}
        onChange={handleChange}
        onKeyDown={handleKey}
        onFocus={() => { if (rows.length) { place(); setOpen(true); } }}
        placeholder={placeholder}
        className={className}
        style={style}
        autoComplete="off"
        spellCheck={false}
      />
      {dropdown}
    </div>
  );
};

export default Icd10Picker;
