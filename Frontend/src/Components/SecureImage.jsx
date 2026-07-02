/**
 * SecureImage — <img> that can display authenticated `/uploads/...` files.
 *
 * Uploaded files (visitor photos, signatures, incident attachments) are PHI,
 * so the backend serves /uploads behind the same JWT check as the API
 * (Backend/routes/Files/uploadsRoutes.js). A plain <img src="/uploads/…">
 * can't send the Authorization header — and the `?token=` query fallback is
 * deliberately SSE-only (R7bb-FIX-A-6: query tokens leak into proxy logs).
 *
 * So: for /uploads paths this component fetches the file through axios
 * (the global interceptor attaches the Bearer token), turns the blob into
 * an object URL, and renders that. Everything else (data: URLs, http(s)
 * URLs) passes straight through to a normal <img>.
 *
 * On fetch failure it renders nothing (no broken-image icon, no retry
 * storm) — same graceful-degrade the signature footer already used.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";

export default function SecureImage({ src, alt = "", ...imgProps }) {
  const isProtected = typeof src === "string" && src.startsWith("/uploads/");
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isProtected) return undefined;
    let revoked = null;
    let alive = true;
    setObjectUrl(null);
    setFailed(false);
    axios
      .get(src, { responseType: "blob" })
      .then((res) => {
        if (!alive) return;
        revoked = URL.createObjectURL(res.data);
        setObjectUrl(revoked);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [src, isProtected]);

  if (!src || failed) return null;
  if (!isProtected) return <img src={src} alt={alt} {...imgProps} />;
  if (!objectUrl) return null; // loading — render nothing rather than a broken icon
  return <img src={objectUrl} alt={alt} {...imgProps} />;
}
