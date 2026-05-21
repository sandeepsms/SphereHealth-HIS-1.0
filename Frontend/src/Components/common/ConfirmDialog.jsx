/**
 * R7ax — Reusable confirm() replacement for window.confirm().
 *
 * Usage:
 *   import { confirm } from "../../Components/common/ConfirmDialog";
 *   const ok = await confirm({
 *     title: "Cancel order?",
 *     body: "This will delete the medication and notify pharmacy.",
 *     danger: true,
 *     confirmLabel: "Cancel order",
 *     cancelLabel: "Keep",
 *   });
 *   if (!ok) return;
 *
 * Styling is via the global .his-modal / .his-btn classes in his-design.css.
 * Imperative API uses a module-level React 18+ root mounted on a portal node.
 */
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

let _root = null;
let _container = null;

function getRoot() {
  if (_root) return _root;
  _container = document.createElement("div");
  _container.id = "his-confirm-root";
  document.body.appendChild(_container);
  _root = createRoot(_container);
  return _root;
}

function ConfirmDialogView({
  title,
  body,
  danger,
  confirmLabel,
  cancelLabel,
  onClose,
}) {
  const confirmBtnRef = useRef(null);

  // Auto-focus the primary button on mount + ESC to cancel.
  useEffect(() => {
    confirmBtnRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose(false);
      else if (e.key === "Enter") onClose(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="his-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
      role="presentation"
    >
      <div
        className="his-modal narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="his-confirm-title"
      >
        <div className="his-modal-hdr">
          <h3 id="his-confirm-title">{title || "Are you sure?"}</h3>
          <button
            type="button"
            className="his-modal-close"
            aria-label="Close"
            onClick={() => onClose(false)}
          >
            ×
          </button>
        </div>
        {body ? (
          <div className="his-modal-body">
            {typeof body === "string"
              ? body.split("\n").map((ln, i) => (
                  <p key={i} style={{ margin: i === 0 ? "0 0 8px" : "0 0 8px" }}>
                    {ln}
                  </p>
                ))
              : body}
          </div>
        ) : null}
        <div className="his-modal-ftr">
          <button
            type="button"
            className="his-btn his-btn-ghost"
            onClick={() => onClose(false)}
          >
            {cancelLabel || "Cancel"}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`his-btn ${danger ? "his-btn-red" : "his-btn-primary"}`}
            onClick={() => onClose(true)}
          >
            {confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Show a confirm dialog. Resolves to true (confirm) or false (cancel/close/ESC).
 */
export function confirm(opts = {}) {
  const root = getRoot();
  return new Promise((resolve) => {
    const close = (result) => {
      root.render(null);
      resolve(Boolean(result));
    };
    root.render(
      <ConfirmDialogView
        title={opts.title}
        body={opts.body}
        danger={!!opts.danger}
        confirmLabel={opts.confirmLabel}
        cancelLabel={opts.cancelLabel}
        onClose={close}
      />,
    );
  });
}

export default confirm;
