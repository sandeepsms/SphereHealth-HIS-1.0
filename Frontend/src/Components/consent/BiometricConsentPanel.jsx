/**
 * BiometricConsentPanel.jsx — R7ez
 *
 * Three-step paperless consent ceremony rendered as a single card:
 *   1. Consenting party — relation + name + ID proof + contact
 *   2. Biometric capture — Windows Hello (platform authenticator)
 *      via WebAuthn. The fingerprint never leaves the device; we
 *      store only the cryptographic attestation.
 *   3. Staff e-signature — drawn signature image via SignaturePad.
 *      Auto-fills name/role from AuthContext.
 *
 * Each block updates a server-side state machine through dedicated
 * endpoints so the ConsentForm doc always reflects the latest progress
 * — partial captures survive a page reload. The parent (ConsentFormPage)
 * passes the consentId once the PENDING form is created; until then
 * the panel renders a disabled placeholder.
 */

import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { startRegistration } from "@simplewebauthn/browser";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import SignaturePad from "../signature/SignaturePad";

const API = `${API_ENDPOINTS.BASE}/consent-forms`;

const RELATION_OPTIONS = [
  { value: "SELF",     label: "Self (patient themselves)" },
  { value: "SPOUSE",   label: "Spouse" },
  { value: "FATHER",   label: "Father" },
  { value: "MOTHER",   label: "Mother" },
  { value: "SON",      label: "Son" },
  { value: "DAUGHTER", label: "Daughter" },
  { value: "GUARDIAN", label: "Legal Guardian" },
  { value: "LAR",      label: "Legally Authorised Representative" },
  { value: "OTHER",    label: "Other (specify)" },
];

const ID_PROOF_OPTIONS = [
  { value: "",                label: "Not provided" },
  { value: "AADHAAR",         label: "Aadhaar" },
  { value: "PAN",             label: "PAN" },
  { value: "DRIVING_LICENSE", label: "Driving License" },
  { value: "PASSPORT",        label: "Passport" },
  { value: "VOTER_ID",        label: "Voter ID" },
  { value: "OTHER",           label: "Other" },
];

const C = {
  bg:     "#f8fafc",   card: "#ffffff",  border: "#e2e8f0",
  text:   "#0f172a",   muted: "#64748b",
  ok:     "#16a34a",   okL:   "#dcfce7", okB:   "#86efac",
  warn:   "#d97706",   warnL: "#fef3c7",
  err:    "#dc2626",   errL:  "#fef2f2", errB:  "#fca5a5",
  blue:   "#1d4ed8",   blueL: "#dbeafe",
  purple: "#7c3aed",   purpleL:"#f3e8ff",
};

const fmtDt = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

export default function BiometricConsentPanel({
  consentId,
  // Initial consent state from parent — server snapshot.
  initialConsentingParty,
  initialBiometric,
  initialStaffSignature,
  initialBypass,
  // R7hr-162 — pre-fill block from the "Consent Given By" section of the
  // parent form (relation, name, contact). When this is present and
  // initialConsentingParty is empty (i.e. nothing saved server-side yet),
  // we seed Step-1 inputs from it AND collapse the name/contact/relation
  // rows so the staff only fills ID Proof Type + ID Proof Number here —
  // the rest is already on file in "Consent Given By".
  parentParty,
  onUpdated,       // fires after every successful sub-step
  onAllComplete,   // fires when all three blocks are green
  disabled,
}) {
  const { user } = useAuth();
  const headers = useMemo(() => {
    const t = sessionStorage.getItem("his_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  }, []);

  /* ── Local state mirrors server progress ────────────────────── */
  // R7hr-162 — Map parent "Consent Given By" enum (SELF/GUARDIAN/SPOUSE/
  // RELATIVE/LEGAL_REP) onto the biometric panel's RELATION_OPTIONS
  // (which historically used different keys). Done inline so legacy
  // server values continue to work even when parentParty is absent.
  const _mapParentRelation = (r) => {
    const x = String(r || "").toUpperCase();
    if (!x) return "SELF";
    if (x === "GUARDIAN" || x === "PARENT") return "GUARDIAN";
    return x; // SELF / SPOUSE / RELATIVE / LEGAL_REP all flow through
  };
  // True only when the parent form has filled the Consent-Given-By data
  // AND no server-side consenting party has been saved yet. In that case
  // we pre-fill + collapse the duplicate name/contact/relation inputs.
  const partyPrefilledFromParent = !!(parentParty && parentParty.name && !initialConsentingParty?.name);

  const [party, setParty]               = useState(() => ({
    relation:      initialConsentingParty?.relation
                   || (partyPrefilledFromParent ? _mapParentRelation(parentParty?.relation) : "SELF"),
    relationOther: initialConsentingParty?.relationOther  || parentParty?.relationOther || "",
    name:          initialConsentingParty?.name           || (partyPrefilledFromParent ? parentParty?.name : "") || "",
    idProofType:   initialConsentingParty?.idProofType    || "",
    idProofNumber: initialConsentingParty?.idProofNumber  || "",
    contactNumber: initialConsentingParty?.contactNumber  || (partyPrefilledFromParent ? parentParty?.contactNumber : "") || "",
  }));
  const [partySaved, setPartySaved]     = useState(() => !!(initialConsentingParty?.name && initialConsentingParty?.relation));
  const [savingParty, setSavingParty]   = useState(false);

  // R7hr-162 — Don't trust prior-session biometric on render. The capture
  // success UI must only appear after the staff actually invokes WebAuthn
  // in THIS session (touches the Capture Fingerprint button and the
  // hardware scanner). If a draft was loaded with a server-side capture,
  // we still keep the data in state for audit but suppress the green
  // "Captured" card until justCaptured flips true. Prevents the bug where
  // the receptionist opened the page and saw "Captured" without ever
  // clicking the scanner.
  const [biometric, setBiometric]       = useState(initialBiometric || {});
  const [justCaptured, setJustCaptured] = useState(false);
  const [capturing, setCapturing]       = useState(false);
  const [biometricError, setBiometricError] = useState("");

  const [staffSig, setStaffSig]         = useState(initialStaffSignature || {});
  const [showSigPad, setShowSigPad]     = useState(false);
  const [savingSig, setSavingSig]       = useState(false);

  const [bypass, setBypass]             = useState(initialBypass || {});
  const [showBypass, setShowBypass]     = useState(false);
  const [bypassReason, setBypassReason] = useState("");
  const [savingBypass, setSavingBypass] = useState(false);

  /* ── Derived ── */
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const isBypassed = !!(bypass?.authorisedAt && bypass?.reason);
  // R7hr-162 — `hasBiometric` now also requires `justCaptured` so the
  // success UI never shows up unless the staff invoked the scanner in
  // this session. Server-stored captures from prior sessions/drafts are
  // ignored for the visual confirmation; the staff must re-capture.
  const hasBiometric = justCaptured && !!(biometric?.captured && biometric?.capturedAt);
  const hasStaffSig  = !!(staffSig?.signatureImage || staffSig?.signedAt);
  const allComplete = (isBypassed || hasBiometric) && hasStaffSig && partySaved;

  // Push completion up to parent so the Sign-and-Lock button can enable.
  useEffect(() => {
    if (allComplete && onAllComplete) onAllComplete();
  }, [allComplete, onAllComplete]);

  /* ── Handlers ── */
  const setPartyField = (k) => (e) => setParty((p) => ({ ...p, [k]: e.target.value }));

  const saveParty = async () => {
    if (!consentId) return toast.warn("Save the consent form first");
    if (!party.name?.trim() || !party.relation) {
      return toast.warn("Name + relation are required");
    }
    setSavingParty(true);
    try {
      const res = await axios.put(`${API}/${consentId}/consenting-party`, party, { headers });
      const cp = res.data?.data?.consentingParty;
      if (cp) setParty((p) => ({ ...p, ...cp }));
      setPartySaved(true);
      toast.success("Consenting party saved");
      onUpdated?.(res.data?.data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save consenting party");
    } finally {
      setSavingParty(false);
    }
  };

  const captureFingerprint = async () => {
    if (!consentId) return toast.warn("Save the consent form first");
    if (!partySaved) return toast.warn("Save consenting party details first");
    if (!window.PublicKeyCredential) {
      setBiometricError("This browser does not support biometric capture (WebAuthn). Use Chrome/Edge on Windows or Safari on macOS with a built-in scanner.");
      return;
    }
    setCapturing(true);
    setBiometricError("");
    try {
      // 1. Ask backend for a fresh registration challenge.
      const opts = await axios.post(`${API}/${consentId}/biometric/options`, {}, { headers });
      // 2. Browser prompts Windows Hello → user touches scanner.
      const attestation = await startRegistration({ optionsJSON: opts.data.options });
      // 3. Send attestation back for server-side verification.
      const verify = await axios.post(`${API}/${consentId}/biometric/verify`, { attestation }, { headers });
      setBiometric({
        captured: true,
        method: "WEBAUTHN",
        capturedAt: verify.data?.data?.capturedAt || new Date().toISOString(),
        credentialFingerprint: verify.data?.data?.credentialFingerprint || "",
        // R7gh — show vendor name so the staff visibly confirms the
        // capture came from a real hardware scanner.
        isHardwareBacked:    !!verify.data?.data?.isHardwareBacked,
        authenticatorVendor: verify.data?.data?.authenticatorVendor || "",
      });
      // R7hr-162 — gate the visual confirmation behind this flag so the
      // green "Captured" card only shows for a SESSION-initiated capture.
      setJustCaptured(true);
      const vendor = verify.data?.data?.authenticatorVendor;
      toast.success(vendor ? `Biometric captured ✓ ${vendor}` : "Biometric captured ✓");
      onUpdated?.();
    } catch (err) {
      // R7gh — Hardware-required is a server-side reject (status 400,
      // code HARDWARE_REQUIRED). Show the server's explanatory message
      // verbatim so the staff knows it was a virtual / software
      // authenticator and to retry with the laptop's real scanner.
      const serverCode = err.response?.data?.code;
      const serverMsg  = err.response?.data?.message;
      if (serverCode === "HARDWARE_REQUIRED") {
        setBiometricError(serverMsg || "Hardware fingerprint scanner required — virtual / software authenticators are blocked");
        toast.error("Hardware scanner required");
        return;
      }
      // WebAuthn errors come as DOMException with .name describing the
      // cause (NotAllowedError = user cancelled, SecurityError = wrong
      // origin, InvalidStateError = no scanner). Show a helpful hint.
      const msg = err.name === "NotAllowedError" ? "Capture cancelled — patient did not touch the scanner in time"
                : err.name === "InvalidStateError" ? "No biometric scanner found on this device — try a different laptop or use admin bypass"
                : err.name === "NotSupportedError" ? "This authenticator does not support fingerprint capture"
                : serverMsg || err.message || "Biometric capture failed";
      setBiometricError(msg);
      toast.error(msg);
    } finally {
      setCapturing(false);
    }
  };

  const saveStaffSignature = async (dataUrl) => {
    if (!consentId) return toast.warn("Save the consent form first");
    setSavingSig(true);
    try {
      const res = await axios.post(`${API}/${consentId}/staff-sign`, { signatureImage: dataUrl }, { headers });
      setStaffSig({
        signedAt: res.data?.data?.signedAt || new Date().toISOString(),
        userName: res.data?.data?.userName || user?.fullName || "",
        userRole: res.data?.data?.userRole || user?.role || "",
        signatureImage: dataUrl,
      });
      setShowSigPad(false);
      toast.success("Staff signature saved");
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save signature");
    } finally {
      setSavingSig(false);
    }
  };

  const submitBypass = async () => {
    if (!consentId) return;
    if (!bypassReason.trim() || bypassReason.trim().length < 10) {
      return toast.warn("Reason must be at least 10 characters");
    }
    setSavingBypass(true);
    try {
      const res = await axios.post(`${API}/${consentId}/bypass`, { reason: bypassReason.trim() }, { headers });
      setBypass(res.data?.data || {});
      setShowBypass(false);
      setBypassReason("");
      toast.success("Bypass authorised");
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Bypass failed");
    } finally {
      setSavingBypass(false);
    }
  };

  if (!consentId) {
    return (
      <div style={{
        background: C.warnL, border: `1.5px dashed ${C.warn}40`, borderRadius: 10,
        padding: "14px 18px", color: C.warn, fontSize: 12, fontWeight: 600, marginTop: 14,
      }}>
        <i className="pi pi-info-circle" style={{ marginRight: 8 }} />
        Save the consent draft first to capture biometric + e-signature.
      </div>
    );
  }

  return (
    <div className="hga-enter" style={{
      background: C.card, border: `1.5px solid ${allComplete ? C.ok : C.border}`, borderRadius: 12,
      padding: "16px 18px", marginTop: 16, position: "relative",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <i className="pi pi-id-card" style={{ fontSize: 18, color: C.purple }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Paperless Authentication</div>
            <div style={{ fontSize: 10.5, color: C.muted }}>NABH PRE.4 — Biometric + Staff E-signature + Timestamp</div>
          </div>
        </div>
        {allComplete && (
          <span style={{
            background: C.okL, color: C.ok, border: `1px solid ${C.okB}`, padding: "4px 10px",
            borderRadius: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: ".3px",
          }}>
            <i className="pi pi-check-circle" style={{ marginRight: 5 }} />READY TO SIGN
          </span>
        )}
      </div>

      {/* ── Step 1 — Consenting party ─────────────────────────────── */}
      <Section
        n={1} title="Consenting Party" done={partySaved}
        subtitle={partyPrefilledFromParent
          ? "Pre-filled from \"Consent Given By\" — confirm ID proof below"
          : "Who will place the fingerprint? (patient or LAR)"}
      >
        {/* R7hr-162 — Compact summary band shown when name/relation/contact
            came from the parent "Consent Given By" section. Avoids the
            previous duplicate data-entry where the staff had to retype
            the same name + relation + contact a second time. The ID Proof
            Type + Number remain editable below because they're NOT
            collected upstream in "Consent Given By". */}
        {partyPrefilledFromParent && (
          <div style={{
            background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8,
            padding: "10px 12px", marginTop: 6, marginBottom: 10, fontSize: 12,
            display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center",
          }}>
            <span style={{ color: C.muted, fontWeight: 600 }}>
              <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
              From "Consent Given By":
            </span>
            <span><strong style={{ color: C.text }}>{party.name || "—"}</strong></span>
            <span style={{ color: C.muted }}>·</span>
            <span><span style={{ color: C.muted }}>Relation:</span> <strong style={{ color: C.text }}>{(RELATION_OPTIONS.find(o => o.value === party.relation)?.label) || party.relation}</strong></span>
            {party.contactNumber && (<>
              <span style={{ color: C.muted }}>·</span>
              <span style={{ color: C.muted }}>📞 {party.contactNumber}</span>
            </>)}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
          {/* When pre-filled from parent, hide the duplicate Relation /
              Name / Contact inputs and only collect ID Proof Type + Number.
              Otherwise (legacy flow) show all six fields as before. */}
          {!partyPrefilledFromParent && (
            <>
              <FieldSelect label="Relation *" value={party.relation} onChange={setPartyField("relation")} disabled={partySaved || disabled} options={RELATION_OPTIONS} />
              {party.relation === "OTHER" && (
                <Field label="Specify relation" value={party.relationOther} onChange={setPartyField("relationOther")} disabled={partySaved || disabled} />
              )}
              <Field label="Name *" value={party.name} onChange={setPartyField("name")} disabled={partySaved || disabled} placeholder="Full name of the consenting party" />
              <Field label="Contact number" value={party.contactNumber} onChange={setPartyField("contactNumber")} disabled={partySaved || disabled} placeholder="+91 ..." />
            </>
          )}
          <FieldSelect label="ID Proof type" value={party.idProofType} onChange={setPartyField("idProofType")} disabled={partySaved || disabled} options={ID_PROOF_OPTIONS} />
          <Field label="ID Proof number" value={party.idProofNumber} onChange={setPartyField("idProofNumber")} disabled={partySaved || disabled} placeholder="Number (last 4 digits visible on receipt)" />
        </div>
        {!partySaved && (
          <div style={{ marginTop: 10, textAlign: "right" }}>
            <button
              onClick={saveParty}
              disabled={savingParty || disabled}
              style={btnPrimary(savingParty || disabled)}
            >
              {savingParty ? "Saving…" : "Save consenting party"}
            </button>
          </div>
        )}
      </Section>

      {/* ── Step 2 — Biometric ────────────────────────────────────── */}
      <Section
        n={2} title="Fingerprint Capture" done={hasBiometric || isBypassed}
        subtitle={isBypassed
          ? `BYPASSED · ${bypass?.authorisedByName || ""} · ${fmtDt(bypass?.authorisedAt)}`
          : "Place finger on the laptop's biometric scanner (Windows Hello)"}
      >
        {hasBiometric && !isBypassed && (
          <div style={{
            background: C.okL, border: `1px solid ${C.okB}`, borderRadius: 8,
            padding: "10px 12px", fontSize: 12, color: C.ok,
          }}>
            <i className="pi pi-check-circle" style={{ marginRight: 6 }} />
            Captured · {fmtDt(biometric.capturedAt)}
            {/* R7gh — surface vendor + hardware badge so the staff
                visibly confirms a REAL scanner was used. */}
            {biometric.authenticatorVendor && (
              <div style={{ fontSize: 11, color: C.text, marginTop: 4, fontWeight: 600 }}>
                {biometric.authenticatorVendor}
                {biometric.isHardwareBacked && (
                  <span style={{
                    marginLeft: 8, padding: "2px 7px", background: "#0f766e", color: "white",
                    borderRadius: 4, fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px",
                  }}>
                    HARDWARE
                  </span>
                )}
              </div>
            )}
            {biometric.credentialFingerprint && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4, fontFamily: "monospace" }}>
                Credential fingerprint: {biometric.credentialFingerprint}
              </div>
            )}
          </div>
        )}
        {isBypassed && (
          <div style={{
            background: C.warnL, border: `1.5px dashed ${C.warn}`, borderRadius: 8,
            padding: "10px 12px", fontSize: 12, color: C.warn,
          }}>
            <i className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />
            Biometric bypassed by admin
            <div style={{ marginTop: 4, color: C.text, fontWeight: 600 }}>Reason: {bypass.reason}</div>
          </div>
        )}
        {!hasBiometric && !isBypassed && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={captureFingerprint}
              disabled={capturing || !partySaved || disabled}
              style={btnAccent(capturing || !partySaved || disabled, C.purple)}
            >
              <i className="pi pi-id-card" style={{ marginRight: 8 }} />
              {capturing ? "Awaiting scan…" : "Capture Fingerprint"}
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowBypass(true)}
                disabled={disabled}
                style={btnGhost(disabled)}
              >
                Bypass (admin)
              </button>
            )}
          </div>
        )}
        {biometricError && (
          <div style={{ marginTop: 8, color: C.err, fontSize: 11.5, background: C.errL, border: `1px solid ${C.errB}`, borderRadius: 6, padding: "6px 10px" }}>
            <i className="pi pi-times-circle" style={{ marginRight: 6 }} />
            {biometricError}
          </div>
        )}
      </Section>

      {/* ── Step 3 — Staff signature ──────────────────────────────── */}
      <Section
        n={3} title="Staff / Doctor Digital Signature" done={hasStaffSig}
        subtitle={hasStaffSig
          ? `${staffSig.userName || user?.fullName} · ${staffSig.userRole || user?.role} · ${fmtDt(staffSig.signedAt)}`
          : `Signed by: ${user?.fullName || "—"} · ${user?.role || "—"}`}
      >
        {hasStaffSig && staffSig.signatureImage && (
          <div style={{
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, display: "inline-block",
          }}>
            <img src={staffSig.signatureImage} alt="staff signature" style={{ height: 56, maxWidth: 220 }} />
          </div>
        )}
        {!hasStaffSig && (
          <div>
            <button
              onClick={() => setShowSigPad(true)}
              disabled={disabled}
              style={btnPrimary(disabled)}
            >
              <i className="pi pi-pencil" style={{ marginRight: 8 }} />
              Draw signature
            </button>
          </div>
        )}
      </Section>

      {/* Signature pad modal */}
      {showSigPad && (
        <SignaturePad
          existing={null}
          userName={user?.fullName || ""}
          onSave={saveStaffSignature}
          onCancel={() => setShowSigPad(false)}
        />
      )}

      {/* Bypass modal */}
      {showBypass && (
        <div style={modalBackdrop} onClick={() => !savingBypass && setShowBypass(false)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.err, marginBottom: 4 }}>
              <i className="pi pi-shield" style={{ marginRight: 8 }} />
              Bypass biometric capture
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>
              Admin-only escape valve. The reason becomes part of the consent's permanent audit trail.
            </div>
            <textarea
              autoFocus
              value={bypassReason}
              onChange={(e) => setBypassReason(e.target.value)}
              placeholder="Why is biometric capture not possible? (min 10 chars — e.g. 'Patient hand bandaged + no LAR available')"
              rows={4}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                fontFamily: "inherit", fontSize: 12, resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setShowBypass(false)} disabled={savingBypass} style={btnGhost(savingBypass)}>Cancel</button>
              <button onClick={submitBypass} disabled={savingBypass || bypassReason.trim().length < 10} style={btnDanger(savingBypass)}>
                {savingBypass ? "Authorising…" : "Authorise bypass"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────── */

function Section({ n, title, subtitle, done, children }) {
  return (
    <div style={{
      borderTop: `1px dashed ${C.border}`, marginTop: 14, paddingTop: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 11, fontSize: 11, fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: done ? C.okL : C.bg, color: done ? C.ok : C.muted,
          border: `1.5px solid ${done ? C.okB : C.border}`,
        }}>
          {done ? <i className="pi pi-check" style={{ fontSize: 10 }} /> : n}
        </span>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{title}</div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, marginLeft: 32 }}>{subtitle}</div>
      <div style={{ marginLeft: 32 }}>{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, disabled, placeholder }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      <input
        type="text"
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "6px 9px", border: `1px solid ${C.border}`, borderRadius: 6,
          fontSize: 12, fontFamily: "inherit", background: disabled ? C.bg : "white",
        }}
      />
    </label>
  );
}

function FieldSelect({ label, value, onChange, disabled, options }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{
          width: "100%", padding: "6px 9px", border: `1px solid ${C.border}`, borderRadius: 6,
          fontSize: 12, fontFamily: "inherit", background: disabled ? C.bg : "white",
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const baseBtn = (disabled) => ({
  padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
  border: "none", fontFamily: "inherit",
});
const btnPrimary = (disabled) => ({ ...baseBtn(disabled), background: C.blue, color: "white" });
const btnAccent  = (disabled, color) => ({ ...baseBtn(disabled), background: color, color: "white" });
const btnDanger  = (disabled) => ({ ...baseBtn(disabled), background: C.err, color: "white" });
const btnGhost   = (disabled) => ({
  ...baseBtn(disabled), background: "white", color: C.text, border: `1.5px solid ${C.border}`,
});

const modalBackdrop = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 9999,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
};
const modalCard = {
  background: "white", borderRadius: 14, padding: "22px 24px", maxWidth: 480, width: "100%",
  boxShadow: "0 30px 80px rgba(0,0,0,.25)",
};
