/**
 * SafetyComponents.jsx
 * ════════════════════════════════════════════════════════════════
 * Bundles every "patient-safety" UI primitive in one place so the
 * patient panel only has to import one module. Each component is
 * self-contained — pass props, render, done.
 *
 * Includes:
 *   • TwoIdConfirmModal     — IPSG.2 verification gate (A1)
 *   • CriticalResultBanner  — auto-shows when a lab result is critical (A5)
 *   • SurgicalChecklistModal — WHO Sign In / Time Out / Sign Out (A4)
 *   • PainReassessBanner    — opioid → 30/60-min reassessment timer (A3)
 *   • BreakGlassModal       — non-attending physician justification (D14)
 *   • IdleLockOverlay       — full-screen lock on idle timeout (D15)
 *   • TwoFactorModal        — OTP prompt for high-risk actions (D16)
 *   • PinnedVitals          — sticky strip on long pages (G27)
 */

import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import "../../pages/patient/patient-file.css";

const BASE = API_ENDPOINTS.BASE;

/* ─────────── TwoIdConfirmModal — Roadmap A1 ─────────── */
export function TwoIdConfirmModal({ patient, action, onConfirm, onCancel }) {
  const [name, setName] = useState("");
  const [dob, setDob]   = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");
  const expectName = (patient?.fullName || "").trim().toLowerCase();
  const expectDob  = patient?.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().slice(0, 10) : "";

  const submit = async () => {
    setErr("");
    if (name.trim().toLowerCase() !== expectName) return setErr("Patient name doesn't match the chart");
    if (expectDob && dob !== expectDob)            return setErr("Date of birth doesn't match the chart");
    setBusy(true);
    try {
      await axios.post(`${BASE}/safety/two-id-confirm`, {
        uhid: patient.UHID, dob, fullName: name, action,
      });
      onConfirm?.();
    } catch (e) {
      setErr(e.response?.data?.message || "Could not record confirmation");
    } finally { setBusy(false); }
  };

  return (
    <div className="pf-modal-backdrop" onClick={onCancel}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Two-identifier patient confirmation">
        <div className="pf-modal__head">
          <div>
            <div className="pf-modal__title">🛡 IPSG.2 — Two-Patient-Identifier Check</div>
            <div className="pf-modal__sub">Confirm the patient before "{action}"</div>
          </div>
          <button className="pf-modal__close" onClick={onCancel} aria-label="cancel">✕</button>
        </div>
        <div className="pf-modal__body">
          <div className="pf-info-box pf-info-box--blue">
            <strong>Expected:</strong> {patient?.fullName} · UHID {patient?.UHID}
            {expectDob && <> · DOB {expectDob}</>}
          </div>
          <div>
            <label className="pf-flabel pf-flabel--required">Type the patient's FULL NAME *</label>
            <input className="pf-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </div>
          {expectDob && (
            <div>
              <label className="pf-flabel pf-flabel--required">DOB (YYYY-MM-DD) *</label>
              <input className="pf-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
          )}
          {err && <div className="pf-fhint pf-fhint--error">{err}</div>}
        </div>
        <div className="pf-modal__foot">
          <button className="pf-action pf-action--quiet" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="pf-action pf-action--accent" onClick={submit} disabled={busy || !name}>
            {busy ? "Verifying…" : "✓ Confirm Identity"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── CriticalResultBanner — Roadmap A5 ─────────── */
export function CriticalResultBanner({ patientUHID, results = [], onAck }) {
  const unack = results.filter((r) => r.isCritical && !r.acknowledged);
  if (unack.length === 0) return null;
  return (
    <div className="pf-alert pf-alert--danger" role="alertdialog" aria-live="assertive">
      <span className="pf-alert__icon">🩸</span>
      <div className="pf-alert__body">
        <div className="pf-alert__title">{unack.length} Critical Result{unack.length > 1 ? "s" : ""} Pending Acknowledgement</div>
        <div className="pf-alert__msg">
          {unack.slice(0, 3).map((r) => `${r.testName}: ${r.value} ${r.unit || ""} (ref ${r.refRange || "—"})`).join(" · ")}
          {unack.length > 3 ? ` · +${unack.length - 3} more` : ""}
        </div>
      </div>
      <button
        className="pf-alert__btn"
        onClick={async () => {
          for (const r of unack) {
            try {
              await axios.post(`${BASE}/safety/critical-result/${r._id}/acknowledge`, {
                uhid: patientUHID,
                resultLabel: r.testName,
                value: r.value,
                refRange: r.refRange,
                comment: "Acknowledged via patient panel",
              });
            } catch {}
          }
          onAck?.();
        }}
      >Acknowledge All</button>
    </div>
  );
}

/* ─────────── SurgicalChecklistModal — Roadmap A4 ─────────── */
const WHO_SIGN_IN  = [
  "Patient identity, site, procedure, consent confirmed",
  "Site marked / not applicable",
  "Anaesthesia safety check complete",
  "Pulse oximeter on patient & functioning",
  "Allergy reviewed",
  "Difficult airway / aspiration risk reviewed",
  "Blood loss risk > 500 ml plan in place",
];
const WHO_TIME_OUT = [
  "All team members introduced by name and role",
  "Surgeon, anaesthetist & nurse confirm patient/site/procedure",
  "Antibiotic prophylaxis given within last 60 min",
  "Critical events anticipated by surgeon",
  "Critical events anticipated by anaesthetist",
  "Critical events anticipated by nursing team",
  "Essential imaging displayed",
];
const WHO_SIGN_OUT = [
  "Procedure recorded",
  "Instrument, sponge, needle counts correct",
  "Specimen labelled (incl. patient name)",
  "Equipment issues identified to address",
  "Key concerns for recovery & management reviewed",
];

export function SurgicalChecklistModal({ patient, procedureId, onClose, onComplete }) {
  const [phase, setPhase] = useState("SIGN_IN");
  const [items, setItems] = useState({});
  const [confirmedBy, setConfirmedBy] = useState({ surgeon: "", anaesthetist: "", nurse: "" });
  const [busy, setBusy] = useState(false);
  const checklist = phase === "SIGN_IN" ? WHO_SIGN_IN : phase === "TIME_OUT" ? WHO_TIME_OUT : WHO_SIGN_OUT;
  const allChecked = checklist.every((c) => items[c]);

  const submit = async () => {
    if (!allChecked) return;
    setBusy(true);
    try {
      await axios.post(`${BASE}/safety/surgical-checklist`, {
        uhid: patient.UHID, procedureId, phase,
        items: checklist.map((c) => ({ key: c, value: !!items[c] })),
        confirmedBy: Object.entries(confirmedBy)
          .filter(([, v]) => v.trim())
          .map(([role, name]) => ({ role, name })),
      });
      onComplete?.(phase);
      if (phase === "SIGN_IN")  { setPhase("TIME_OUT"); setItems({}); }
      else if (phase === "TIME_OUT") { setPhase("SIGN_OUT"); setItems({}); }
      else                       onClose?.();
    } catch (e) {
      alert("Could not record checklist: " + (e.response?.data?.message || e.message));
    } finally { setBusy(false); }
  };

  return (
    <div className="pf-modal-backdrop" onClick={onClose}>
      <div className="pf-modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="WHO Surgical Safety Checklist">
        <div className="pf-modal__head">
          <div>
            <div className="pf-modal__title">⚕ WHO Surgical Safety Checklist</div>
            <div className="pf-modal__sub">{patient?.fullName} · UHID {patient?.UHID} · Phase: <strong>{phase.replace("_", " ")}</strong></div>
          </div>
          <button className="pf-modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="pf-modal__body">
          <div className="pf-pill-row">
            {["SIGN_IN", "TIME_OUT", "SIGN_OUT"].map((p) => (
              <div key={p} className={`pf-pill ${phase === p ? "pf-pill--info" : "pf-pill--neutral"}`}>
                <span className="pf-pill__label">{p.replace("_", " ")}</span>
                <span className="pf-pill__val">{phase === p ? "•" : "·"}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {checklist.map((c) => (
              <label key={c} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 12px", background: items[c] ? "var(--pf-ok-l)" : "var(--pf-bg)", border: "1px solid var(--pf-border)", borderRadius: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!items[c]}
                  onChange={(e) => setItems((m) => ({ ...m, [c]: e.target.checked }))}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: 13 }}>{c}</span>
              </label>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {["surgeon", "anaesthetist", "nurse"].map((role) => (
              <div key={role}>
                <label className="pf-flabel">{role}</label>
                <input
                  className="pf-input"
                  value={confirmedBy[role]}
                  onChange={(e) => setConfirmedBy((s) => ({ ...s, [role]: e.target.value }))}
                  placeholder={`Name`}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="pf-modal__foot">
          <button className="pf-action pf-action--quiet" onClick={onClose} disabled={busy}>Close</button>
          <button className="pf-action pf-action--accent" onClick={submit} disabled={busy || !allChecked}>
            {busy ? "Saving…" : phase === "SIGN_OUT" ? "✓ Complete Checklist" : `Save & Continue to ${phase === "SIGN_IN" ? "Time Out" : "Sign Out"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── PainReassessBanner — Roadmap A3 ─────────── */
export function PainReassessBanner({ patientUHID, lastOpioidAt, lastReassessAt }) {
  if (!lastOpioidAt) return null;
  const since = Date.now() - new Date(lastOpioidAt).getTime();
  const overdue = since > 30 * 60_000 && (!lastReassessAt || new Date(lastReassessAt) < new Date(lastOpioidAt));
  if (!overdue) return null;
  const mins = Math.floor(since / 60_000);
  return (
    <div className="pf-alert pf-alert--warn" role="status" aria-live="polite">
      <span className="pf-alert__icon">⏰</span>
      <div className="pf-alert__body">
        <div className="pf-alert__title">Pain Reassessment Window Open</div>
        <div className="pf-alert__msg">
          Opioid administered {mins} min ago — NABH COP.18 requires pain reassessment within 30 minutes.
        </div>
      </div>
      <button className="pf-alert__btn" onClick={() => window.open(`/nursing-notes?uhid=${patientUHID}&template=pain-reassess`, "_blank")}>
        Record Now
      </button>
    </div>
  );
}

/* ─────────── BreakGlassModal — Roadmap D14 ─────────── */
export function BreakGlassModal({ patient, onAllow, onCancel }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (reason.trim().length < 10) return setErr("Justification must be at least 10 characters");
    setBusy(true); setErr("");
    try {
      await axios.post(`${BASE}/safety/break-glass`, { uhid: patient.UHID, reason });
      onAllow?.(reason);
    } catch (e) {
      setErr(e.response?.data?.message || "Could not log break-glass access");
    } finally { setBusy(false); }
  };
  return (
    <div className="pf-modal-backdrop" onClick={onCancel}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Break-glass access justification">
        <div className="pf-modal__head" style={{ background: "linear-gradient(135deg,#7f1d1d,#dc2626)" }}>
          <div>
            <div className="pf-modal__title">🔓 Break-Glass Access</div>
            <div className="pf-modal__sub">You are not the attending physician for this patient.</div>
          </div>
          <button className="pf-modal__close" onClick={onCancel} aria-label="close">✕</button>
        </div>
        <div className="pf-modal__body">
          <div className="pf-info-box">
            Accessing <strong>{patient?.fullName}</strong> (UHID {patient?.UHID}) without being on the treating team is a flagged event.
            Provide a clinical justification — it will appear on the audit feed and is reviewable by the medical superintendent.
          </div>
          <div>
            <label className="pf-flabel pf-flabel--required">Reason for access (min 10 chars) *</label>
            <textarea className="pf-textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ICU consult requested by primary team; emergency cross-cover; etc." />
          </div>
          {err && <div className="pf-fhint pf-fhint--error">{err}</div>}
        </div>
        <div className="pf-modal__foot">
          <button className="pf-action pf-action--quiet" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="pf-action pf-action--danger" onClick={submit} disabled={busy || reason.trim().length < 10}>
            {busy ? "Logging…" : "Acknowledge & Access"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── IdleLockOverlay — Roadmap D15 ─────────── */
export function IdleLockOverlay({ onUnlock }) {
  return (
    <div className="pf-modal-backdrop" style={{ background: "rgba(15,23,42,.9)" }} role="alertdialog" aria-label="Session locked due to inactivity">
      <div className="pf-modal" style={{ maxWidth: 420, textAlign: "center" }}>
        <div className="pf-modal__head" style={{ background: "linear-gradient(135deg,#1e293b,#475569)" }}>
          <div style={{ width: "100%", textAlign: "center" }}>
            <div className="pf-modal__title">🔒 Session Locked</div>
            <div className="pf-modal__sub">Idle for 10 minutes</div>
          </div>
        </div>
        <div className="pf-modal__body" style={{ alignItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>🛌</div>
          <div style={{ fontSize: 13, color: "var(--pf-muted)" }}>
            The patient chart was left unattended. Confirm you are still here to resume — or log out if you've stepped away.
          </div>
        </div>
        <div className="pf-modal__foot" style={{ justifyContent: "center" }}>
          <button className="pf-action pf-action--accent" onClick={onUnlock} autoFocus>I'm here — resume</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── TwoFactorModal — Roadmap D16 ─────────── */
export function TwoFactorModal({ open, busy, purpose, otp, setOtp, error, submit, cancel, devOtp }) {
  if (!open) return null;
  return (
    <div className="pf-modal-backdrop" onClick={cancel}>
      <div className="pf-modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Two-factor confirmation">
        <div className="pf-modal__head">
          <div>
            <div className="pf-modal__title">🔐 Confirm with OTP</div>
            <div className="pf-modal__sub">{purpose.replace(/-/g, " ")}</div>
          </div>
          <button className="pf-modal__close" onClick={cancel} aria-label="cancel">✕</button>
        </div>
        <div className="pf-modal__body">
          <div className="pf-info-box pf-info-box--blue">
            A 6-digit OTP has been sent to your registered phone. Enter it below to authorise this action.
            {devOtp && <div style={{ marginTop: 8, color: "#9a3412" }}><strong>DEV-MODE OTP:</strong> {devOtp}</div>}
          </div>
          <div>
            <label className="pf-flabel pf-flabel--required">OTP *</label>
            <input
              className="pf-input"
              autoFocus
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              style={{ fontSize: 20, letterSpacing: 10, textAlign: "center", fontFamily: "monospace" }}
              placeholder="000000"
            />
          </div>
          {error && <div className="pf-fhint pf-fhint--error">{error}</div>}
        </div>
        <div className="pf-modal__foot">
          <button className="pf-action pf-action--quiet" onClick={cancel} disabled={busy}>Cancel</button>
          <button className="pf-action pf-action--accent" onClick={submit} disabled={busy || otp.length !== 6}>
            {busy ? "Verifying…" : "Verify"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── PinnedVitals strip — Roadmap G27 ─────────── */
export function PinnedVitals({ vitals, recordedAt, visible = true }) {
  if (!visible || !vitals) return null;
  const items = [
    { k: "BP",   v: vitals.bp ? `${vitals.bp.systolic || "—"}/${vitals.bp.diastolic || "—"}` : null, u: "mmHg" },
    { k: "P",    v: vitals.pulse,                                                                u: "bpm" },
    { k: "T",    v: vitals.temp,                                                                 u: "°F" },
    { k: "SpO₂", v: vitals.spo2,                                                                 u: "%" },
    { k: "RR",   v: vitals.rr,                                                                   u: "/min" },
  ].filter((x) => x.v != null && x.v !== "");
  if (!items.length) return null;
  return (
    <div className="pf-pinned-vitals" role="region" aria-label="Pinned latest vitals">
      <span className="pf-pinned-vitals__heart" aria-hidden>💓</span>
      {items.map((it, i) => (
        <span key={i} className="pf-pinned-vitals__item">
          <span className="pf-pinned-vitals__k">{it.k}</span>
          <span className="pf-pinned-vitals__v">{it.v}<span className="pf-pinned-vitals__u">{it.u}</span></span>
        </span>
      ))}
      {recordedAt && <span className="pf-pinned-vitals__time">{new Date(recordedAt).toLocaleString("en-IN",{hour:"2-digit",minute:"2-digit",day:"2-digit",month:"short"})}</span>}
    </div>
  );
}

/* ─────────── Offline MAR Queue — Roadmap E19 (utility, no UI) ─────────── */
const OFFLINE_DB = "pf-offline-mar";
function openDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(OFFLINE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
export async function enqueueOfflineMar(entry) {
  try {
    const db = await openDB();
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").add({ ...entry, queuedAt: Date.now() });
    return new Promise((res) => { tx.oncomplete = () => res(true); });
  } catch { return false; }
}
export async function flushOfflineMar(submitFn) {
  try {
    const db = await openDB();
    const tx = db.transaction("queue", "readwrite");
    const store = tx.objectStore("queue");
    const rows = await new Promise((res) => { const r = store.getAll(); r.onsuccess = () => res(r.result); });
    for (const row of rows) {
      try { await submitFn(row); store.delete(row.id); } catch { /* leave for next flush */ }
    }
    return rows.length;
  } catch { return 0; }
}
// Background flush attempt when network returns
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    // The caller wires in their submit function; we just kick a custom event
    // and let the consumer decide what to flush.
    window.dispatchEvent(new CustomEvent("pf-online", { detail: { at: Date.now() } }));
  });
}
