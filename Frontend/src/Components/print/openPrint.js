// Components/print/openPrint.js
// Helper used everywhere in the app: openPrint("opd-receipt", payload)
// stashes the payload in sessionStorage so the new window can read it,
// then opens /print/<slug>?ts=… as a separate tab (large payload =
// sessionStorage; small payload could go in `?data=base64(json)`).
//
// Returns the new window reference so the caller can close it if needed.

export function openPrint(slug, payload, opts = {}) {
  if (!slug) throw new Error("openPrint requires a slug");
  const key = `printPayload-${slug}`;
  try {
    if (payload != null) sessionStorage.setItem(key, JSON.stringify(payload));
  } catch { /* sessionStorage full / unavailable */ }

  const features = opts.features
    || "popup=yes,width=900,height=1100,resizable=yes,scrollbars=yes";

  // ts query forces a fresh window if user opens multiple in a row
  const ts = Date.now();
  const win = window.open(`/print/${encodeURIComponent(slug)}?ts=${ts}`, opts.target || `_print_${slug}`, features);
  if (!win) {
    alert("Browser blocked the print window. Please allow popups for this site and try again.");
  }
  return win;
}
