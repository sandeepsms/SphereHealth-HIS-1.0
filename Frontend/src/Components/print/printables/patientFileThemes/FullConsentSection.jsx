/**
 * FullConsentSection.jsx — R7hr(DOCS-FULL, owner 2026-07-12)
 * ────────────────────────────────────────────────────────────
 * Standalone-level consent records inside the Complete Patient File: one
 * block per consent with the procedure description, risks / benefits /
 * alternatives disclosure, language & interpreter, consenting party
 * (guardian details when not the patient), explaining doctor, biometric
 * authentication summary, refusal / revocation trail and the signature
 * line — instead of the old one-row signed-status register.
 *
 * Data: `file.consents[].full` = raw ConsentFormModel doc (normalizeData
 * passthrough). Model-key-first chains; renders nothing without `full`
 * (the caller keeps the legacy MiniTable for old payloads).
 */
import React from "react";

const S = {
  card: { border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", margin: "5px 0", breakInside: "avoid" },
  title: { fontSize: 10.5, fontWeight: 800, color: "#0f172a" },
  meta: { fontSize: 8.5, color: "#64748b", margin: "1px 0 3px" },
  h: { fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#475569", margin: "4px 0 1px" },
  p: { fontSize: 10, color: "#0f172a", margin: "1px 0", lineHeight: 1.45, whiteSpace: "pre-wrap" },
  sign: { fontSize: 8.5, color: "#475569", marginTop: 4, borderTop: "1px dashed #e2e8f0", paddingTop: 3 },
  refuse: { border: "1px solid #fca5a5", background: "#fef2f2", borderRadius: 5, padding: "4px 8px", margin: "4px 0", fontSize: 9.5, color: "#991b1b" },
};

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const has = (v) => Array.isArray(v) ? v.length > 0 : !!str(v);
const fmtDT = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? str(v) : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

export default function FullConsentSection({ file }) {
  const consents = (file?.consents || []).filter((c) => c.full);
  if (!consents.length) return null;
  return (
    <>
      {consents.map((c, i) => {
        const x = c.full || {};
        const statusRaw = str(x.status || (c.signed ? "signed" : "")).toLowerCase();
        const badge = statusRaw === "signed" ? "✓ SIGNED"
          : statusRaw === "refused" ? "✗ REFUSED"
          : statusRaw === "revoked" ? "⊘ REVOKED"
          : "PENDING";
        const bio = x.biometric || {};
        return (
          <div key={i} style={S.card}>
            <div style={S.title}>
              {str(x.consentTitle || c.name) || "Consent"}
              {has(x.consentType) ? ` · ${str(x.consentType).toUpperCase()}` : ""}
              {` · ${badge}`}
            </div>
            <div style={S.meta}>
              {[has(x.languageUsed) ? `Language: ${str(x.languageUsed)}` : "",
                x.interpreterRequired ? `Interpreter: ${str(x.interpreterName) || "required"}` : "",
                has(x.explainedByDoctorName) ? `Explained by ${str(x.explainedByDoctorName)}${has(x.doctorRegNo) ? ` (Reg ${str(x.doctorRegNo)})` : ""}` : ""].filter(Boolean).join(" · ")}
            </div>
            {has(x.procedureDescription) && <><div style={S.h}>Procedure / Scope</div><div style={S.p}>{str(x.procedureDescription)}</div></>}
            {has(x.risksDisclosed) && <><div style={S.h}>Risks Disclosed</div><div style={S.p}>{Array.isArray(x.risksDisclosed) ? x.risksDisclosed.map((r) => `• ${str(typeof r === "string" ? r : r.text || r.risk)}`).join("\n") : str(x.risksDisclosed)}</div></>}
            {has(x.benefitsExplained) && <><div style={S.h}>Benefits Explained</div><div style={S.p}>{str(x.benefitsExplained)}</div></>}
            {has(x.alternativesDisclosed) && <><div style={S.h}>Alternatives Disclosed</div><div style={S.p}>{str(x.alternativesDisclosed)}</div></>}
            {(has(x.consentGivenBy) || has(x.guardianName)) && (
              <><div style={S.h}>Consenting Party</div>
              <div style={S.p}>
                {str(x.consentGivenBy) || "Patient"}
                {has(x.guardianName) ? ` — ${str(x.guardianName)}${has(x.guardianRelation) ? ` (${str(x.guardianRelation)})` : ""}${has(x.guardianContact) ? ` · ${str(x.guardianContact)}` : ""}` : ""}
              </div></>
            )}
            {(bio.capturedAt || has(bio.consentingParty) || has(bio.credentialId)) && (
              <><div style={S.h}>Biometric Authentication</div>
              <div style={S.p}>
                {[has(bio.consentingParty) ? `Party: ${str(bio.consentingParty)}` : "",
                  bio.capturedAt ? `Captured ${fmtDT(bio.capturedAt)}` : "",
                  has(bio.scanner || bio.aaguid) ? `Device: ${str(bio.scanner || bio.aaguid)}` : "",
                  has(bio.credentialId) ? `Credential …${str(bio.credentialId).slice(-8)}` : "",
                  x.bypass ? "⚠ BIOMETRIC BYPASSED" : ""].filter(Boolean).join(" · ")}
              </div></>
            )}
            {statusRaw === "refused" && (
              <div style={S.refuse}><strong>REFUSED</strong>{x.refusedAt ? ` · ${fmtDT(x.refusedAt)}` : ""}{has(x.refusedByName) ? ` · by ${str(x.refusedByName)}` : ""}{has(x.refusalReason) ? ` — ${str(x.refusalReason)}` : ""}</div>
            )}
            {statusRaw === "revoked" && (
              <div style={S.refuse}><strong>REVOKED</strong>{x.revokedAt ? ` · ${fmtDT(x.revokedAt)}` : ""}{has(x.revokedByName) ? ` · by ${str(x.revokedByName)}` : ""}{has(x.revokedReason) ? ` — ${str(x.revokedReason)}` : ""}</div>
            )}
            {has(x.additionalNotes) && <><div style={S.h}>Notes</div><div style={S.p}>{str(x.additionalNotes)}</div></>}
            <div style={S.sign}>
              {[has(x.signedByName || c.signedBy) ? `Signed by ${str(x.signedByName || c.signedBy)}${has(x.signedByRole) ? ` (${str(x.signedByRole)})` : ""}` : "",
                (x.signedAt || c.signedAt) ? fmtDT(x.signedAt || c.signedAt) : "",
                has(x.witnessName || c.witness) ? `Witness: ${str(x.witnessName || c.witness)}${has(x.witnessRelation) ? ` (${str(x.witnessRelation)})` : ""}` : "",
                x.patientAcknowledged ? "Patient acknowledged" : ""].filter(Boolean).join(" · ") || "Signature pending"}
            </div>
          </div>
        );
      })}
    </>
  );
}
