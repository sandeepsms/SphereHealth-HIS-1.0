/**
 * useDigitalSignature.js
 * Manages a user's digital signature (drawn canvas → base64 PNG).
 *
 * Signature is stored:
 *   1. In localStorage (cache): `sphere_sig_{userId}`
 *   2. In backend User model  : PATCH /api/auth/signature
 *
 * Usage:
 *   const { signature, showSetup, setShowSetup, saveSignature, clearSignature } = useDigitalSignature();
 *
 *   - signature    : base64 data URL or null
 *   - showSetup    : boolean — controls the SignaturePad modal
 *   - setShowSetup : setter
 *   - saveSignature: (dataUrl) => Promise<void>
 *   - clearSignature: () => void
 *
 * On first submit of any form if signature === null, the caller should:
 *   setShowSetup(true)
 * Then wait for signature to be set before proceeding, or proceed without it.
 */
import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { API_ENDPOINTS } from "../config/api";

export function useDigitalSignature() {
  const { user, token } = useAuth();
  const [signature, setSignature] = useState(null);
  const [showSetup, setShowSetup] = useState(false);

  /* Load signature on mount / user change */
  useEffect(() => {
    if (!user) { setSignature(null); return; }

    const uid = user._id || user.id;
    const cacheKey = `sphere_sig_${uid}`;

    // 1. Try localStorage cache first (fastest)
    const cached = localStorage.getItem(cacheKey);
    if (cached) { setSignature(cached); return; }

    // 2. Try user object returned by login/me
    const fromUser = user.signature || user.doctorDetails?.signature || null;
    if (fromUser) {
      localStorage.setItem(cacheKey, fromUser);
      setSignature(fromUser);
      return;
    }

    // 3. Fetch from backend
    if (token) {
      axios
        .get(API_ENDPOINTS.AUTH_SIGNATURE, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          if (res.data.signature) {
            localStorage.setItem(cacheKey, res.data.signature);
            setSignature(res.data.signature);
          }
        })
        .catch(() => { /* no signature yet */ });
    }
  }, [user, token]);

  /* Save signature to localStorage + backend */
  const saveSignature = useCallback(async (dataUrl) => {
    const uid = user?._id || user?.id;
    if (!uid) return;

    const cacheKey = `sphere_sig_${uid}`;
    localStorage.setItem(cacheKey, dataUrl);
    setSignature(dataUrl);

    if (token) {
      try {
        await axios.patch(
          API_ENDPOINTS.AUTH_SIGNATURE,
          { signature: dataUrl },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch (e) {
        console.warn("[Signature] Failed to sync to backend:", e.message);
      }
    }
  }, [user, token]);

  /* Remove signature */
  const clearSignature = useCallback(() => {
    const uid = user?._id || user?.id;
    if (uid) localStorage.removeItem(`sphere_sig_${uid}`);
    setSignature(null);
  }, [user]);

  return { signature, showSetup, setShowSetup, saveSignature, clearSignature };
}
