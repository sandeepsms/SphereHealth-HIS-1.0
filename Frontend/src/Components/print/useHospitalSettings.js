// Components/print/useHospitalSettings.js
// Fetches hospital settings (logo, name, address, GSTIN, accreditation,
// print colors, bank details, terms) once and caches them in memory
// so repeated printable opens don't re-hit the API.

import { useEffect, useState } from "react";
import { API_ENDPOINTS } from "../../config/api";
import authFetch from "../../utils/authFetch";

let _cache = null;
let _pending = null;

export const DEFAULT_SETTINGS = {
  hospitalName: "SphereHealth Hospital",
  tagline:      "NABH Accredited Multi-Specialty Hospital",
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

export function clearHospitalSettingsCache() { _cache = null; }

export default function useHospitalSettings() {
  const [settings, setSettings] = useState(_cache || DEFAULT_SETTINGS);
  const [ready, setReady] = useState(!!_cache);

  useEffect(() => {
    let cancelled = false;
    fetchHospitalSettings().then((s) => {
      if (cancelled) return;
      setSettings(s);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  return { settings, ready };
}
