/**
 * Components/ErrorBoundary.jsx — R7ap-F22/D4-16 + R7bz
 *
 * Per-section error containment so a single component throw doesn't blank
 * the entire page. AccountsConsole has 7 tab components — pre-R7ap an
 * exception in any one (e.g. NaN reduce on Decimal128 payload) unmounted
 * the whole page including the tab strip, so the user couldn't even
 * navigate away.
 *
 * Wrap each high-risk subtree:
 *   <ErrorBoundary label="Revenue tab">
 *     <RevenueTab />
 *   </ErrorBoundary>
 *
 * R7bz: also mounted ONCE at the app root in main.jsx with the
 * `criticalError` prop so an unhandled render crash anywhere in the tree
 * shows a full-screen "Application crashed" takeover instead of a blank
 * page. Per-tab usage continues to render the compact inline fallback.
 *
 * R7bz: when a crash is caught, the boundary best-effort POSTs a small
 * sanitised report to POST /api/client-errors so admin can monitor
 * production crashes on the System Health page. The post uses
 * `keepalive: true` so it survives navigation, is wrapped in try/catch
 * so a reporting failure NEVER cascades into another crash, and includes
 * NO localStorage / sessionStorage / cookies / tokens. message & stack
 * are truncated to 2000 chars each.
 *
 * The fallback shows what failed + a Retry button. The actual error is
 * logged to console + toasted so the user notices without losing the
 * rest of the page.
 */
import React from "react";
import { toast } from "react-toastify";
import { API_BASE_URL as API } from "../config/api";

// R7bz: best-effort POST of a sanitised crash report. Never throws — a
// reporting failure must not turn into another React crash. Hard truncation
// at 2000 chars per spec (PHI safety: stack frames can sometimes contain
// inlined data; bound the surface area).
function reportClientError({ error, info, label }) {
  try {
    const truncate = (s, n) => {
      if (typeof s !== "string") return "";
      return s.length > n ? s.slice(0, n) : s;
    };
    const payload = {
      message: truncate(error?.message || "Unknown error", 2000),
      stack: truncate(error?.stack || "", 2000),
      componentStack: truncate(info?.componentStack || "", 2000),
      label: typeof label === "string" ? label.slice(0, 200) : "unnamed",
      url: (typeof window !== "undefined" && window.location?.href) ? String(window.location.href).slice(0, 500) : "",
      userAgent: (typeof navigator !== "undefined" && navigator.userAgent) ? String(navigator.userAgent).slice(0, 500) : "",
      timestamp: new Date().toISOString(),
    };
    // NOTE: deliberately no Authorization header — the endpoint is soft-auth
    // (attemptAuth), so anonymous reports are accepted and we don't risk
    // attaching a stale/invalid token here. fetch() is preferred over axios
    // so we can pass keepalive: true, which lets the request complete even
    // if the user reloads or navigates away immediately after the crash.
    // NOTE: API_BASE_URL already ends with /api — do not double-prefix.
    fetch(`${API}/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      // best-effort; do not block UI
    }).catch(() => { /* swallow — reporting is best-effort */ });
  } catch (_) {
    /* swallow — never let the reporter crash the boundary */
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "", details: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unknown error", details: error?.stack || "" };
  }

  componentDidCatch(error, info) {
    // Console log full details for developer diagnosis.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${this.props.label || "unnamed"}]`, error, info);
    // Toast a brief notice so the user knows something failed.
    try {
      toast.error(`${this.props.label || "Section"} crashed: ${error?.message || "Unknown error"}`);
    } catch (_) { /* toast may not be ready */ }
    // R7bz: best-effort remote report so we can spot production crashes
    // server-side. Fully isolated — any failure here is swallowed.
    reportClientError({ error, info, label: this.props.label });
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: "", details: "" });
  };

  render() {
    if (this.state.hasError) {
      // R7bz: when criticalError is set (only used by the app-root mount
      // in main.jsx), render a full-screen takeover. The app tree itself
      // has unmounted (this is the last line of defense) so we can't rely
      // on any other UI being available — keep this self-contained and
      // styled inline so a stylesheet failure doesn't make it invisible.
      if (this.props.criticalError) {
        return (
          <div
            role="alert"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 999999,
              background: "#0f172a",
              color: "#f1f5f9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            }}
          >
            <div
              style={{
                maxWidth: 560,
                width: "100%",
                background: "#1e293b",
                border: "1.5px solid #dc2626",
                borderRadius: 14,
                padding: 28,
                textAlign: "center",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ fontSize: 44, marginBottom: 10 }}>
                <i className="pi pi-exclamation-triangle" style={{ color: "#f87171" }} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8, color: "#fecaca" }}>
                Application crashed
              </div>
              <div style={{ fontSize: 13.5, marginBottom: 16, color: "#cbd5e1", lineHeight: 1.5 }}>
                Something went wrong and the page can't continue. The error has
                been reported. Try reloading — if it keeps happening, contact
                IT support.
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: "'DM Mono', monospace",
                  color: "#94a3b8",
                  background: "#0f172a",
                  padding: "8px 12px",
                  borderRadius: 6,
                  marginBottom: 18,
                  wordBreak: "break-word",
                  textAlign: "left",
                }}
              >
                {this.state.message}
              </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: "10px 28px",
                  borderRadius: 8,
                  border: "none",
                  background: "#dc2626",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <i className="pi pi-refresh" style={{ marginRight: 6 }} /> Reload
              </button>
            </div>
          </div>
        );
      }
      // Default: compact inline fallback — unchanged from R7ap so all
      // existing per-tab usage continues to render identically.
      return (
        <div
          role="alert"
          style={{
            padding: 20,
            margin: "12px 0",
            border: "1.5px solid #fca5a5",
            background: "#fef2f2",
            borderRadius: 10,
            color: "#7f1d1d",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
            <i className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />
            {this.props.label || "This section"} crashed
          </div>
          <div style={{ fontSize: 12.5, marginBottom: 10, fontFamily: "'DM Mono', monospace" }}>
            {this.state.message}
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid #dc2626",
              background: "#fff",
              color: "#dc2626",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <i className="pi pi-refresh" style={{ marginRight: 4 }} /> Retry
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginLeft: 8,
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid #94a3b8",
              background: "#fff",
              color: "#475569",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
