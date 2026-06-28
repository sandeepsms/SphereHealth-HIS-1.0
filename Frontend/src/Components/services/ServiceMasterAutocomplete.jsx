/**
 * ServiceMasterAutocomplete.jsx
 * ────────────────────────────────────────────────────────────────
 * Keyboard-friendly, debounced autocomplete for picking a row from
 * ServiceMaster constrained to a single `doctorOrderCategory`.
 *
 * Wired in (R7hr-83 Phase B) from DoctorOrdersPanel:
 *   <ServiceMasterAutocomplete
 *     category="Lab"
 *     value={{ serviceMasterId, serviceCode, serviceName, defaultPrice }}
 *     onChange={(picked) => …}            // picked === null when cleared
 *     placeholder="Search lab tests…"
 *     disabled={false}
 *   />
 *
 * Why this lives in /services/ and not /clinical/:
 *   • The existing `clinical/ServiceAutocomplete.jsx` hits the older
 *     `/api/services?search=…` endpoint and is keyed by ServiceMaster
 *     `category` (LAB/RADIOLOGY/…). The new endpoint `/services/lookup`
 *     filters by `doctorOrderCategory` — the 12-value enum that backs
 *     a DoctorOrder document — so a different concept, different file.
 *
 * Backend contract (already shipped):
 *   GET /api/services/lookup?doctorOrderCategory=<cat>&q=<text>&limit=20
 *   Auth: Bearer sessionStorage.his_token
 *   Response: either a flat `[{…}]` or `{ data: [{…}] }` of
 *             { _id, serviceCode, serviceName, defaultPrice,
 *               doctorOrderCategory }
 *
 * Style notes:
 *   • Inline styles only — DoctorOrdersPanel has no shared CSS and we
 *     don't want to drag a stylesheet into a new directory.
 *   • Colours match the panel's tokens: border #d1d5db, focus #4f46e5,
 *     row hover #f3f4f6.
 *   • Absolutely-positioned popover (no portal) — the parent rows are
 *     already z-stacked and don't clip overflow at the row level, so a
 *     local absolute popover is enough for now. (If a future caller
 *     wraps us in an `overflow:hidden` ancestor we can promote to a
 *     fixed-position portal like DrugAutocomplete.)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* axios may or may not be available depending on bundle config — try
 * the dynamic import path that other panels use, but fall back to fetch
 * gracefully so this component never crashes a tree just because the
 * caller's bundle excluded axios. */
let axios = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  axios = require("axios");
  // CommonJS interop — some bundlers wrap default in `.default`.
  if (axios && axios.default) axios = axios.default;
} catch (_) {
  axios = null;
}

const API_BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE_URL) ||
  "http://localhost:5050/api";

const fmtPrice = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return `₹${v.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
};

/* Pull the same key (`his_token`) that AuthContext + axiosInterceptor
 * write so we don't go out of sync if the migration to a different key
 * ever lands. */
const authHeader = () => {
  let token = "";
  try {
    token = sessionStorage.getItem("his_token") || "";
  } catch (_) {
    /* private-mode browser — proceed without auth, server will 401 */
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function ServiceMasterAutocomplete({
  category,
  value,
  onChange,
  placeholder = "Search services…",
  disabled = false,
}) {
  /* `value` is the controlled selection — when the parent passes a
   * picked row we display its name in the input; otherwise we let the
   * doctor type freely. We mirror it into a local `query` so editing
   * the field after a pick doesn't re-render the parent on every key
   * (parent only hears `onChange` when a real selection changes). */
  const initialQuery = value && value.serviceName ? value.serviceName : "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState(null);

  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const wrapRef = useRef(null);

  /* Re-sync the local query when the parent swaps `value` (e.g. clearing
   * the row, or repopulating from a draft). We only rewrite when the
   * incoming serviceName differs from what's currently shown so the
   * user's mid-typing doesn't get stomped. */
  useEffect(() => {
    const next = value && value.serviceName ? value.serviceName : "";
    if (next !== query) setQuery(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value && value.serviceMasterId, value && value.serviceName]);

  /* Cancel any in-flight request + pending debounce on unmount. */
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch (_) { /* noop */ }
      }
    };
  }, []);

  /* Click-outside closes the popover. We listen on `mousedown` (not
   * `click`) so the close happens before the document-level click ever
   * lands — matters when the autocomplete sits inside a form whose
   * submit handler shouldn't fire on a stray outside-click. */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  /* Core fetcher — runs after the 250ms debounce settles. We accept
   * either a flat array or a `{ data: [...] }` envelope because the
   * backend may switch between the two styles depending on whether
   * the route went through the legacy controller or the new one. */
  const runSearch = useCallback(
    async (q) => {
      if (!category) {
        setResults([]);
        return;
      }
      /* Abort any in-flight request — stale responses for older queries
       * must never overwrite the result list for the latest keystroke. */
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch (_) { /* noop */ }
      }
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      setError(null);

      const url =
        `${API_BASE}/services/lookup` +
        `?doctorOrderCategory=${encodeURIComponent(category)}` +
        `&q=${encodeURIComponent(q)}` +
        `&limit=20`;

      try {
        let payload;
        if (axios) {
          const res = await axios.get(url, {
            headers: authHeader(),
            signal: ac.signal,
          });
          payload = res.data;
        } else {
          const res = await fetch(url, {
            method: "GET",
            headers: { ...authHeader() },
            signal: ac.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          payload = await res.json();
        }
        if (ac.signal.aborted) return;
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload && payload.data)
            ? payload.data
            : [];
        setResults(rows);
        setHighlight(rows.length > 0 ? 0 : -1);
      } catch (e) {
        if (ac.signal.aborted) return;
        if (axios && axios.isCancel && axios.isCancel(e)) return;
        if (e && e.name === "AbortError") return;
        console.warn("[ServiceMasterAutocomplete]", e && e.message);
        setError(e && e.message ? e.message : "Failed to search services");
        setResults([]);
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    },
    [category],
  );

  /* Debounce-on-query. Fires the network request 250ms after the last
   * keystroke. We don't fire for empty queries — show nothing instead
   * of the entire master. */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = (query || "").trim();
    if (!open) return;
    if (q.length === 0) {
      setResults([]);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(q), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  /* When the category prop changes, blow away results — they refer to
   * the previous category's filter and shouldn't survive the switch. */
  useEffect(() => {
    setResults([]);
    setHighlight(-1);
  }, [category]);

  const commitPick = (row) => {
    const picked = {
      serviceMasterId: row._id,
      serviceCode: row.serviceCode || "",
      serviceName: row.serviceName || "",
      defaultPrice:
        row.defaultPrice != null ? Number(row.defaultPrice) : null,
    };
    setQuery(picked.serviceName);
    setResults([]);
    setOpen(false);
    setHighlight(-1);
    if (typeof onChange === "function") onChange(picked);
  };

  const clearSelection = () => {
    setQuery("");
    setResults([]);
    setHighlight(-1);
    if (typeof onChange === "function") onChange(null);
  };

  const onInputChange = (e) => {
    const next = e.target.value;
    setQuery(next);
    setOpen(true);
    /* If the user starts editing after a pick, the controlled value
     * is now stale — emit null so the parent's draft row doesn't carry
     * an invisible reference to the previously-picked service. */
    if (value && value.serviceMasterId && next !== value.serviceName) {
      if (typeof onChange === "function") onChange(null);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length === 0) return;
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open || results.length === 0) return;
      setHighlight((h) => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      if (!open) return;
      if (highlight >= 0 && highlight < results.length) {
        e.preventDefault();
        commitPick(results[highlight]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setHighlight(-1);
    }
  };

  /* Scroll the highlighted row into view when the user is keyboard-
   * navigating through a list longer than the popover. */
  useEffect(() => {
    if (!open || highlight < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-sma-row="${highlight}"]`,
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [highlight, open]);

  const showClear = useMemo(
    () => Boolean(value && value.serviceMasterId) && !disabled,
    [value, disabled],
  );

  /* ── Styles (inline, matched to DoctorOrdersPanel) ── */
  const wrapStyle = { position: "relative", width: "100%", minWidth: 0 };
  const inputStyle = {
    width: "100%",
    padding: "6px 28px 6px 10px",
    fontSize: 13,
    lineHeight: 1.4,
    border: "1px solid #d1d5db",
    borderRadius: 6,
    background: disabled ? "#f9fafb" : "#fff",
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const popoverStyle = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    zIndex: 50,
    background: "#fff",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.12)",
    maxHeight: 320,
    overflowY: "auto",
    minWidth: 280,
  };

  const queryNonEmpty = (query || "").trim().length > 0;

  return (
    <div ref={wrapRef} style={wrapStyle}>
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={onInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          style={inputStyle}
          onFocusCapture={(e) => {
            e.currentTarget.style.borderColor = "#4f46e5";
            e.currentTarget.style.boxShadow =
              "0 0 0 2px rgba(79,70,229, 0.18)";
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.borderColor = "#d1d5db";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        {/* Right-edge affordance: spinner while loading; ✕ when there's
            a confirmed selection so the doctor can re-open the search. */}
        {busy ? (
          <span
            aria-label="Searching"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid #cbd5e1",
              borderTopColor: "#4f46e5",
              animation: "sma-spin 0.7s linear infinite",
              pointerEvents: "none",
            }}
          />
        ) : showClear ? (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clearSelection(); }}
            title="Clear selection"
            aria-label="Clear selection"
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              width: 20,
              height: 20,
              padding: 0,
              border: 0,
              background: "transparent",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        ) : null}
        {/* Inline @keyframes — scoped to a custom name so it doesn't
            collide with any global "spin" the parent app might define. */}
        <style>{`@keyframes sma-spin { to { transform: translateY(-50%) rotate(360deg); } }`}</style>
      </div>

      {open && !disabled && (results.length > 0 || queryNonEmpty || error) && (
        <div ref={listRef} style={popoverStyle} role="listbox">
          {error && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 12,
                color: "#b91c1c",
                background: "#fef2f2",
                borderBottom: "1px solid #fecaca",
              }}
            >
              {error}
            </div>
          )}

          {results.map((row, idx) => {
            const active = idx === highlight;
            return (
              <button
                key={row._id || `${row.serviceCode}-${idx}`}
                data-sma-row={idx}
                type="button"
                role="option"
                aria-selected={active}
                /* onMouseDown (not onClick) so the input doesn't blur
                   first and close the popover before the pick lands. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitPick(row);
                }}
                onMouseEnter={() => setHighlight(idx)}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  textAlign: "left",
                  background: active ? "#f3f4f6" : "#fff",
                  border: 0,
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#0f172a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.serviceName || "(unnamed)"}
                  </div>
                  {row.serviceCode && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#6b7280",
                        fontFamily: "'DM Mono', monospace",
                        marginTop: 1,
                      }}
                    >
                      {row.serviceCode}
                    </div>
                  )}
                </div>
                {row.defaultPrice != null && (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#047857",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {fmtPrice(row.defaultPrice)}
                  </span>
                )}
              </button>
            );
          })}

          {!busy && !error && results.length === 0 && queryNonEmpty && (
            <div
              style={{
                padding: "10px 12px",
                fontSize: 12,
                color: "#6b7280",
                lineHeight: 1.4,
              }}
            >
              No services found — admin can add via Service Master
            </div>
          )}
        </div>
      )}
    </div>
  );
}
