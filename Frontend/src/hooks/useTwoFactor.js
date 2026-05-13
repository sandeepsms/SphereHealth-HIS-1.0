/**
 * useTwoFactor — Roadmap D16.
 *
 * Wraps the /api/2fa/request + /api/2fa/verify endpoints. The calling
 * code (e.g. sign DNR button) invokes `gate(purpose)`; the hook handles
 * OTP request, prompts the user via a small modal-like contract, and
 * resolves with a single-use nonce. The caller passes the nonce as the
 * X-2FA-Nonce header on the actual mutation request.
 */
import { useState, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../config/api";

export function useTwoFactor() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [token, setToken] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [resolver, setResolver] = useState(null);
  const [devOtp, setDevOtp] = useState("");

  const gate = useCallback(async (p) => {
    return new Promise(async (resolve, reject) => {
      setPurpose(p); setOtp(""); setError(""); setOpen(true); setDevOtp("");
      try {
        setBusy(true);
        const r = await axios.post(`${API_ENDPOINTS.BASE}/2fa/request`, { purpose: p });
        setToken(r.data.token);
        if (r.data.devOtp) setDevOtp(r.data.devOtp); // dev mode echoes the OTP
        setResolver(() => ({ resolve, reject }));
      } catch (e) {
        setError(e.response?.data?.message || "Could not request OTP");
        setOpen(false);
        reject(e);
      } finally { setBusy(false); }
    });
  }, []);

  const submit = useCallback(async () => {
    if (!otp || !token) return;
    setBusy(true); setError("");
    try {
      const r = await axios.post(`${API_ENDPOINTS.BASE}/2fa/verify`, { token, otp });
      resolver?.resolve(r.data.nonce);
      setOpen(false);
    } catch (e) {
      setError(e.response?.data?.message || "Invalid OTP");
    } finally { setBusy(false); }
  }, [otp, token, resolver]);

  const cancel = useCallback(() => {
    resolver?.reject(new Error("2FA cancelled by user"));
    setOpen(false);
  }, [resolver]);

  return { gate, open, busy, purpose, otp, setOtp, error, submit, cancel, devOtp };
}
