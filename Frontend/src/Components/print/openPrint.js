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
  const url = `/print/${encodeURIComponent(slug)}?ts=${ts}`;
  const target = opts.target || `_print_${slug}`;
  const win = window.open(url, target, features);
  // R7hr-171: window.open is the strict path — modern browsers' popup
  // blockers occasionally trip even when the call is inside a user
  // gesture (notably on first-load before the user has interacted with
  // the tab, or when Chrome's site-engagement score is low). Anchor-click
  // with target=_blank is treated as a real navigation and survives the
  // popup gate. Sessionstorage payload is already in place above, so the
  // print page renders identically whichever channel reaches it.
  if (!win) {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.target = target;
      // R7hr-171b: NO `noopener` here. Modern Chrome treats
      // <a target="_blank"> as IMPLICITLY noopener, which severs the
      // new tab's sessionStorage from the opener — the print route
      // then sees no JWT and bounces to /login (which is what the
      // user reported on Save & Process IPD). `rel="opener"` is the
      // explicit override that restores sessionStorage inheritance.
      // The print page is same-origin so reverse-tabnabbing isn't a
      // real concern — the security/UX trade-off heavily favours
      // letting the print render at all.
      a.rel = "opener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return null; // anchor-click; no window handle to return
    } catch {
      alert("Browser blocked the print window. Please allow popups for this site and try again.");
    }
  }
  return win;
}
