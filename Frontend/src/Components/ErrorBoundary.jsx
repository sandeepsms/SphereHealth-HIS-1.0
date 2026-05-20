/**
 * Components/ErrorBoundary.jsx — R7ap-F22/D4-16
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
 * The fallback shows what failed + a Retry button. The actual error is
 * logged to console + toasted so the user notices without losing the
 * rest of the page.
 */
import React from "react";
import { toast } from "react-toastify";

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
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: "", details: "" });
  };

  render() {
    if (this.state.hasError) {
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
