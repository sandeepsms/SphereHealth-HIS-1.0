// Components/print/useHospitalSettings.js
// Fetches hospital settings (logo, name, address, GSTIN, accreditation,
// print colors, bank details, terms) once and caches them in memory
// so repeated printable opens don't re-hit the API.
//
// Cache invalidation:
//   - clearHospitalSettingsCache() drops the in-memory cache so the next
//     fetchHospitalSettings() re-hits the API.
//   - A BroadcastChannel("his-hospital-settings") subscription drops the
//     cache when ANY tab posts { type: "invalidated" } — this is how an
//     admin save in Tab A reaches the print module-cache in Tab B.
//   - A `storage` event listener on `his-settings-version` mirrors the
//     same behaviour for browsers without BroadcastChannel (iOS Safari).
//   - Component instances of useHospitalSettings() also re-render on
//     invalidation: the hook subscribes via useEffect, refetches in the
//     background, and pushes the fresh value into local state.

import { useEffect, useState } from "react";
import { API_ENDPOINTS } from "../../config/api";
import authFetch from "../../utils/authFetch";

let _cache = null;
let _pending = null;

// Module-level pub/sub so multiple hook instances all refresh on invalidation.
const _subscribers = new Set();
const _notifySubscribers = () => {
  _subscribers.forEach((fn) => {
    try { fn(); } catch { /* swallow — one bad subscriber must not break others */ }
  });
};

export const DEFAULT_SETTINGS = {
  // R7cb-residual: neutral defaults — a settings-API outage during cold
  // boot must not expose the dev brand on a deployed instance.
  hospitalName: "Hospital",
  tagline:      "",
  logo:         "",
  logoWidth:    120,
  addressLine1: "",
  addressLine2: "",
  city:         "",
  state:        "",
  pincode:      "",
  country:      "India",
  phone1:       "",
  phone2:       "",
  email:        "",
  website:      "",
  gstin:        "",
  registrationNo: "",
  nabh:         true,
  nabl:         false,
  rohiniId:     "",
  panNumber:    "",
  printHeaderColor:  "#1e293b",
  printAccentColor:  "#1d4ed8",
  showLogoInPrint:   true,
  showTaglineInPrint: true,
  billFooterNote: "Thank you for choosing our hospital.",
  termsLine1: "This is a computer-generated bill and does not require a physical signature.",
  termsLine2: "All charges are as per the approved hospital tariff. Payments once made are non-refundable.",
  termsLine3: "For queries, contact the Billing Department.",
  bankName: "", accountNo: "", ifscCode: "", bankBranch: "",
};

export async function fetchHospitalSettings() {
  if (_cache) return _cache;
  if (_pending) return _pending;
  _pending = (async () => {
    try {
      const r = await authFetch(API_ENDPOINTS.HOSPITAL_SETTINGS);
      const data = await r.json();
      const merged = { ...DEFAULT_SETTINGS, ...(data?.data || data || {}) };
      _cache = merged;
      return merged;
    } catch {
      _cache = { ...DEFAULT_SETTINGS };
      return _cache;
    } finally {
      _pending = null;
    }
  })();
  return _pending;
}

export function clearHospitalSettingsCache() {
  _cache = null;
  _pending = null;
}

/* ── Cross-tab invalidation wiring (module-load side-effect) ──────────────
   - BroadcastChannel: instant push between same-origin tabs.
   - localStorage `storage` event: fallback for iOS Safari / older browsers.
   Both paths converge on _invalidateAndRefetch which drops the cache,
   re-fetches fresh data, and notifies every active hook subscriber so
   on-screen components re-render with the new logo / name / GSTIN. */

const STORAGE_KEY = "his-settings-version";
const BC_NAME = "his-hospital-settings";

let _bc = null;
try {
  if (typeof BroadcastChannel !== "undefined") {
    _bc = new BroadcastChannel(BC_NAME);
  }
} catch {
  _bc = null; // older browsers — silently degrade to storage-event fallback
}

const _invalidateAndRefetch = () => {
  _cache = null;
  _pending = null;
  // Kick off a background refetch so the next caller (and our subscribers)
  // sees fresh data without a UI stall.
  fetchHospitalSettings().finally(() => {
    _notifySubscribers();
  });
};

if (_bc) {
  _bc.onmessage = (ev) => {
    if (!ev?.data || ev.data.type === "invalidated") {
      _invalidateAndRefetch();
    }
  };
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  try {
    window.addEventListener("storage", (ev) => {
      if (ev.key === STORAGE_KEY) _invalidateAndRefetch();
    });
  } catch {
    /* SSR or sandboxed env — no-op */
  }
}

export default function useHospitalSettings() {
  const [settings, setSettings] = useState(_cache || DEFAULT_SETTINGS);
  const [ready, setReady] = useState(!!_cache);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchHospitalSettings().then((s) => {
        if (cancelled) return;
        setSettings(s);
        setReady(true);
      });
    };

    load();

    // Re-render when any tab broadcasts an invalidation.
    const onInvalidated = () => { if (!cancelled) load(); };
    _subscribers.add(onInvalidated);

    return () => {
      cancelled = true;
      _subscribers.delete(onInvalidated);
    };
  }, []);

  return { settings, ready };
}
