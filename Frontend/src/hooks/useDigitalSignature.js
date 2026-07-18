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
import { toast } from "react-toastify";
import { useAuth } from "../context/AuthContext";
import { API_ENDPOINTS } from "../config/api";

export function useDigitalSignature() {
  const { user, token } = useAuth();
  const [signature, setSignature] = useState(null);
  const [showSetup, setShowSetup] = useState(false);

  /* Load signature on mount / user change.
   * R9-FIX(R9-110): the cache was used and then RETURNED without ever
   * revalidating against the backend — a stale (or tampered) localStorage
   * signature was trusted forever, so a printed clinical document could carry
   * an out-of-date / wrong signature. Now the cache is only an OPTIMISTIC first
   * paint; the server value (from the user object or a GET) is authoritative
   * and reconciles the cache — including clearing a local-only signature the
   * backend doesn't actually have. */
  useEffect(() => {
    if (!user) { setSignature(null); return; }

    const uid = user._id || user.id;
    const cacheKey = `sphere_sig_${uid}`;
    let cancelled = false;

    // 1. Optimistic: paint the cached signature immediately for responsiveness.
    const cached = localStorage.getItem(cacheKey);
    if (cached) setSignature(cached);

    // 2. Reconcile against the authoritative server value.
    const fromUser = user.signature || user.doctorDetails?.signature || null;
    if (fromUser) {
      if (fromUser !== cached) {
        localStorage.setItem(cacheKey, fromUser);
        setSignature(fromUser);
      }
      return () => { cancelled = true; };
    }

    if (token) {
      axios
        .get(API_ENDPOINTS.AUTH_SIGNATURE, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          if (cancelled) return;
          const serverSig = res.data?.signature || null;
          if (serverSig) {
            if (serverSig !== cached) {
              localStorage.setItem(cacheKey, serverSig);
              setSignature(serverSig);
            }
          } else if (cached) {
            // Backend has no signature but the cache does → a stale local-only
            // value (e.g. left behind by the pre-fix swallow-on-failure save).
            // Clear it so the user is prompted to (re-)register, rather than
            // silently signing with a signature the server never stored.
            localStorage.removeItem(cacheKey);
            setSignature(null);
          }
        })
        .catch(() => { /* transient fetch error — keep the optimistic cache */ });
    }
    return () => { cancelled = true; };
  }, [user, token]);

  /* Save signature — SERVER-AUTHORITATIVE.
   * R9-FIX(R9-110): the old path wrote localStorage + state FIRST and then
   * swallowed a failed backend PATCH (console.warn only) — so the UI showed the
   * signature as "saved" while the server never received it. The next session /
   * another device had no signature, and clinical documents could be signed
   * against a signature that doesn't exist server-side. Now we PATCH first and
   * only cache + set state on a 2xx; on failure we surface a toast, leave the
   * prior signature untouched, and return false so the caller can keep the
   * setup modal open instead of proceeding. */
  const saveSignature = useCallback(async (dataUrl) => {
    const uid = user?._id || user?.id;
    if (!uid) return false;
    if (!token) {
      toast.error("You must be signed in to save a signature.");
      return false;
    }

    const cacheKey = `sphere_sig_${uid}`;
    try {
      const res = await axios.patch(
        API_ENDPOINTS.AUTH_SIGNATURE,
        { signature: dataUrl },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status >= 200 && res.status < 300) {
        localStorage.setItem(cacheKey, dataUrl);
        setSignature(dataUrl);
        return true;
      }
      throw new Error(`Unexpected status ${res.status}`);
    } catch (e) {
      console.error("[Signature] backend save failed:", e?.message || e);
      toast.error("Signature could not be saved to the server. Please try again.");
      return false; // leave the prior signature intact; caller keeps modal open
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
