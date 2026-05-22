/**
 * InputDialog.jsx — R7az-D4-HIGH-3 / D5-HIGH-5
 *
 * Reusable replacement for window.prompt(). Same imperative shape as
 * ./ConfirmDialog so callers don't need to keep a hooks-y open/onClose
 * state pair just to collect a single short reason string.
 *
 * Usage:
 *   import { promptInput } from "../../Components/common/InputDialog";
 *   const reason = await promptInput({
 *     title: "Discontinue medication?",
 *     body:  "Enter a clinical reason. This goes into the patient's MAR audit trail.",
 *     placeholder: "e.g. Adverse reaction — switching to alternative",
 *     required: true,
 *     confirmLabel: "Discontinue",
 *     danger: true,
 *   });
 *   if (reason == null) return;        // user pressed Cancel / ESC
 *   await axios.post(..., { reason });
 *
 * Returns:
 *   - the user-entered string on submit
 *   - null when the user cancels (matches window.prompt semantics so
 *     existing callers that test `reason == null` continue to work).
 *
 * Reuses .his-modal-* / .his-btn-* classes from his-design.css so this
 * theme-matches every other confirm/modal in the HIS.
 */
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

let _root = null;
let _container = null;

function getRoot() {
  if (_root) return _root;
  _container = document.createElement("div");
  _container.id = "his-input-root";
  document.body.appendChild(_container);
  _root = createRoot(_container);
  return _root;
}

function InputDialogView({
  title,
  body,
  placeholder,
  defaultValue,
  required,
  multiline,
  confirmLabel,
  cancelLabel,
  danger,
  inputType,
  onClose,
}) {
  const [value, setValue] = useState(defaultValue || "");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef(null);

  // Auto-focus the input on mount; ESC cancels (returns null); Enter
  // submits when the value passes the required check.
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose(null);
      // Don't fire Enter on multiline — newline character should land in
      // the textarea. Submit via the explicit button instead.
      else if (e.key === "Enter" && !multiline) submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    if (required && !value.trim()) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }
    onClose(value);
  };

  const inputStyle = {
    width: "100%",
    padding: "9px 11px",
    fontSize: 13,
    border: `1px solid ${touched && required && !value.trim() ? "#dc2626" : "#cbd5e1"}`,
    borderRadius: 8,
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div
      className="his-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(null);
      }}
      role="presentation"
    >
      <div
        className="his-modal narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="his-input-title"
      >
        <div className="his-modal-hdr">
          <h3 id="his-input-title">{title || "Enter value"}</h3>
          <button
            type="button"
            className="his-modal-close"
            aria-label="Close"
            onClick={() => onClose(null)}
          >
            ×
          </button>
        </div>
        <div className="his-modal-body">
          {body ? (
            <div style={{ marginBottom: 10, color: "#475569", fontSize: 13, lineHeight: 1.5 }}>
              {typeof body === "string"
                ? body.split("\n").map((ln, i) => <p key={i} style={{ margin: i === 0 ? "0 0 6px" : "0 0 6px" }}>{ln}</p>)
                : body}
            </div>
          ) : null}
          {multiline ? (
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder || ""}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", minHeight: 70, fontFamily: "inherit" }}
            />
          ) : (
            <input
              ref={inputRef}
              type={inputType || "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder || ""}
              style={inputStyle}
            />
          )}
          {touched && required && !value.trim() && (
            <div style={{ color: "#dc2626", fontSize: 11, marginTop: 5, fontWeight: 600 }}>
              This field is required.
            </div>
          )}
        </div>
        <div className="his-modal-ftr">
          <button
            type="button"
            className="his-btn his-btn-ghost"
            onClick={() => onClose(null)}
          >
            {cancelLabel || "Cancel"}
          </button>
          <button
            type="button"
            className={`his-btn ${danger ? "his-btn-red" : "his-btn-primary"}`}
            onClick={submit}
          >
            {confirmLabel || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Imperative prompt — resolves to the user-entered string, or `null`
 * when cancelled / closed / ESC.
 *
 *   const reason = await promptInput({ title: "…", required: true });
 *   if (reason == null) return;
 */
export function promptInput(opts = {}) {
  const root = getRoot();
  return new Promise((resolve) => {
    const close = (result) => {
      root.render(null);
      resolve(result == null ? null : String(result));
    };
    root.render(
      <InputDialogView
        title={opts.title}
        body={opts.body}
        placeholder={opts.placeholder}
        defaultValue={opts.defaultValue}
        required={!!opts.required}
        multiline={!!opts.multiline}
        confirmLabel={opts.confirmLabel}
        cancelLabel={opts.cancelLabel}
        danger={!!opts.danger}
        inputType={opts.inputType}
        onClose={close}
      />,
    );
  });
}

export default promptInput;
