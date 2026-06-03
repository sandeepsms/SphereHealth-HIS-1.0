import React, { createContext, useContext, useEffect, useState } from "react";

import { API_BASE_URL as API_URL } from "../config/api";

/* ── Defaults (used while loading or if API fails) ─────────────────────── */
/* R7cb-residual: neutral defaults so a settings-API outage doesn't expose
   the dev brand on a deployed instance. */
export const DEFAULT_SETTINGS = {
  hospitalName:       "Hospital",
  tagline:            "",
  logo:               "",
  logoWidth:          120,
  addressLine1:       "",
  addressLine2:       "",
  city:               "",
  state:              "",
  pincode:            "",
  country:            "India",
  phone1:             "",
  phone2:             "",
  email:              "",
  website:            "",
  fax:                "",
  gstin:              "",
  registrationNo:     "",
  nabh:               true,
  nabl:               false,
  rohiniId:           "",
  panNumber:          "",
  printHeaderColor:   "#1e293b",
  printAccentColor:   "#1d4ed8",
  showLogoInPrint:    true,
  showTaglineInPrint: true,
  billFooterNote:     "Thank you for choosing our hospital.",
  termsLine1:         "This is a computer-generated bill and does not require a physical signature.",
  termsLine2:         "All charges are as per the approved hospital tariff. Payments once made are non-refundable.",
  termsLine3:         "For queries, contact the Billing Department.",
  bankName:           "",
  accountNo:          "",
  ifscCode:           "",
  bankBranch:         "",
};

const HospitalSettingsContext = createContext({ settings: DEFAULT_SETTINGS, loading: true, reload: () => {} });

export function HospitalSettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading,  setLoading]  = useState(true);

  const fetchSettings = async () => {
    try {
      // R7cc: backend GET /api/hospital-settings sits behind the global
      // `authenticate` middleware (routes/index.js line 87). Without the
      // bearer token the request returns 401 → json.success is false → we
      // silently fell through to DEFAULT_SETTINGS, which is why admin's
      // saved values looked like "they reset" on next page load. Send the
      // per-tab JWT same as every other authenticated call in the app.
      const token = (typeof sessionStorage !== "undefined")
        ? sessionStorage.getItem("his_token")
        : null;
      const res  = await fetch(`${API_URL}/hospital-settings`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.success && json.data) {
        setSettings({ ...DEFAULT_SETTINGS, ...json.data });
        // Keep the print module-cache in lockstep with the context — when
        // reload() lands fresh settings (e.g. right after an admin save),
        // any PrintShell-routed printable that opens next must NOT serve
        // a stale logo / GSTIN from the singleton _cache.
        // Imported inside the callback to dodge the circular-import risk
        // (the print hook itself does not depend on this context, but
        //  keeping the import lazy is safer if either side grows later).
        try {
          const mod = await import("../Components/print/useHospitalSettings");
          mod.clearHospitalSettingsCache?.();
        } catch { /* import failures are non-fatal — context still has fresh data */ }
      }
    } catch {
      /* silently keep defaults */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    // R7fs: re-fetch when authentication state flips. With R7y's
    // sessionStorage JWT model, the very first mount happens on the
    // login page where no token exists; the backend GET is now public
    // so we DO get the real hospital identity then — but we still
    // listen for these events so a fresh login (or a different user
    // signing in mid-session) re-pulls in case admin just edited the
    // settings, AND so the print-module cache stays in sync.
    //   • "his:auth-changed" — dispatched by AuthContext on login /
    //     logout / token refresh (this file owns the contract — see
    //     dispatchAuthChanged() in AuthContext).
    //   • "storage" — fires when another tab writes/clears the JWT
    //     (cross-tab login). sessionStorage doesn't cross tabs, but
    //     a future migration that pings a shared key (e.g. for "you
    //     just logged out in another tab" UX) would still surface
    //     here, so the listener is cheap insurance.
    const onAuthChanged = () => { fetchSettings(); };
    window.addEventListener("his:auth-changed", onAuthChanged);
    window.addEventListener("storage",          onAuthChanged);
    return () => {
      window.removeEventListener("his:auth-changed", onAuthChanged);
      window.removeEventListener("storage",          onAuthChanged);
    };
  }, []);

  return (
    <HospitalSettingsContext.Provider value={{ settings, loading, reload: fetchSettings }}>
      {children}
    </HospitalSettingsContext.Provider>
  );
}

/* ── Hook ───────────────────────────────────────────────────────────────── */
export function useHospitalSettings() {
  return useContext(HospitalSettingsContext);
}

/* ── Helper: build full address string ──────────────────────────────────── */
export function buildAddress(s) {
  return [s.addressLine1, s.addressLine2, s.city, s.state, s.pincode]
    .filter(Boolean).join(", ");
}

/* ── Helper: build contact line ─────────────────────────────────────────── */
export function buildContact(s) {
  const parts = [];
  if (s.phone1) parts.push(`📞 ${s.phone1}`);
  if (s.phone2) parts.push(s.phone2);
  if (s.email)  parts.push(`✉ ${s.email}`);
  return parts.join("   |   ");
}
