/**
 * consentBiometricService.js — R7ez
 *
 * Thin wrapper around @simplewebauthn/server that the consent controller
 * uses to (a) issue a registration challenge to the browser and (b)
 * verify the attestation that comes back. We use the REGISTRATION
 * ceremony (not authentication) because each consent records a brand-
 * new biometric attestation — the consenting party is not pre-enrolled
 * with our system; they simply touch the laptop's Windows Hello scanner
 * at the moment of consent. The resulting credential is a one-time
 * proof artefact, not a reusable identity.
 *
 * Why this is paperless-grade evidence:
 *   1. The browser cryptographically signs a server-issued challenge
 *      using a key that only exists inside the authenticator chip
 *      (TPM/SE) — proof that THIS device, at THIS moment, performed
 *      a user-verifying gesture (fingerprint, PIN, face).
 *   2. The server stamps capturedAt + IP + user-agent on success,
 *      anchoring the event to wall-clock time.
 *   3. The staff member's digital signature (drawn via SignaturePad)
 *      attaches a human identity at the same moment.
 *   4. Together (biometric attestation + staff sign + timestamps +
 *      consent text) form a tamper-evident packet equivalent to the
 *      paper "thumb impression + doctor signature + date" artefact.
 */

"use strict";

const crypto = require("crypto");

let webauthn;
try {
  webauthn = require("@simplewebauthn/server");
} catch (e) {
  console.error("[consentBiometric] @simplewebauthn/server not installed:", e.message);
}

// Relying-Party identity. Browser checks rpID === current origin's
// hostname (no port), so anything serving the page works in dev. In
// production set RP_ID env var to the hospital's domain.
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "SphereHealth HIS";
const RP_ID   = process.env.WEBAUTHN_RP_ID   || "localhost";
const ORIGIN_FALLBACK = process.env.WEBAUTHN_ORIGIN || "http://localhost:5173";

// Challenge TTL — short window prevents replay if a captured options
// payload leaks. 3 minutes is enough for a patient to touch the scanner
// without rushing.
const CHALLENGE_TTL_MS = 3 * 60 * 1000;

// R7gh — Hardware-only enforcement.
//
// Without this allowlist a malicious user could spawn a virtual
// authenticator (Chrome DevTools → WebAuthn tab → "Add authenticator")
// or run a software-only Windows Hello (no TPM) and the existing
// `attestationType: "none"` flow would happily accept it. Either case
// would NOT prove a real fingerprint touched a real scanner — exactly
// the assurance the hospital needs for NABH PRE.4 + IT-Act 3A.
//
// Source of AAGUIDs: FIDO MDS (Metadata Service) + vendor docs.
//   https://fidoalliance.org/metadata/
// To add new ones in field, set HARDWARE_AAGUID_EXTRA env var:
//   HARDWARE_AAGUID_EXTRA="aaguid1,aaguid2"
const HARDWARE_AAGUIDS = new Map([
  // Windows Hello — TPM-backed (the one users will hit on laptops)
  ["9ddd1817-af5a-4672-a2b9-3e3dd95000a9", "Windows Hello Hardware Authenticator (TPM)"],
  ["6028b017-b1d4-4c02-b4b3-afcdafc96bb2", "Windows Hello VBS (Virtualization-Based Security)"],
  // Apple — Secure Enclave-backed
  ["dd4ec289-e01d-41c9-bb89-70fa845d4bf2", "Apple Touch ID / Face ID (Secure Enclave)"],
  ["fbfc3007-154e-4ecc-8c0b-6e020557d7bd", "Apple Touch ID / Face ID (iCloud Keychain)"],
  ["bada5566-a7aa-401f-bd96-45619a55120d", "Apple Platform Authenticator"],
  // Android — StrongBox/TEE-backed
  ["b93fd961-f2e6-462f-b122-82002247de78", "Android Authenticator (StrongBox/TEE)"],
  // ChromeOS — TPM-backed
  ["771b48fd-d3d4-4f74-9232-fc157ab0507a", "ChromeOS Authenticator (TPM)"],
]);

// Known software / virtual / sketchy AAGUIDs we should ACTIVELY reject
// with a clear error so the operator knows why. Anything not in the
// hardware allowlist falls through to the generic "unknown" reject too,
// but these get a friendlier message.
const REJECTED_AAGUIDS = new Map([
  ["00000000-0000-0000-0000-000000000000", "Virtual / null AAGUID — not a real hardware scanner"],
  ["08987058-cadc-4b81-b6e1-30de50dcbe96", "Windows Hello Software (no TPM) — needs hardware scanner"],
  // Chrome's WebAuthn DevTools virtual authenticator — Bluink Inc.
  ["6e96969e-a5cf-4aab-9b08-aab6bc4f96bf", "Chrome DevTools Virtual Authenticator — testing only, refused"],
]);

const _extraHwAaguids = String(process.env.HARDWARE_AAGUID_EXTRA || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
_extraHwAaguids.forEach(a => HARDWARE_AAGUIDS.set(a, "Operator-approved hardware authenticator (env)"));

// Toggle for dev/test workstations that genuinely lack a fingerprint
// scanner. NEVER set this in production.
const STRICT_HARDWARE = (process.env.STRICT_HARDWARE_BIOMETRIC || "true").toLowerCase() === "true";

function classifyAaguid(aaguidRaw) {
  const aaguid = String(aaguidRaw || "").trim().toLowerCase();
  if (!aaguid) {
    return { isHardware: false, vendor: "", rejectReason: "Missing AAGUID — authenticator did not identify itself" };
  }
  const rejectMsg = REJECTED_AAGUIDS.get(aaguid);
  if (rejectMsg) {
    return { isHardware: false, vendor: "", rejectReason: rejectMsg };
  }
  const vendor = HARDWARE_AAGUIDS.get(aaguid);
  if (vendor) {
    return { isHardware: true, vendor, rejectReason: "" };
  }
  return {
    isHardware: false,
    vendor: "",
    rejectReason: `Unknown authenticator AAGUID ${aaguid} — not on the approved hardware list. ` +
                  "Use the laptop's built-in fingerprint scanner (Windows Hello / Touch ID), " +
                  "or ask the admin to add this device to HARDWARE_AAGUID_EXTRA after vetting.",
  };
}

/**
 * Generate a registration ceremony options object.
 *
 * @param {object} consent — the ConsentForm document we're capturing for
 * @param {string} hostnameHint — req.hostname (browser-reported); used
 *   only as the rpID fallback if env var isn't set.
 * @returns {object} {options, expectedChallenge, expectedChallengeExpiresAt}
 */
async function makeRegistrationOptions(consent, hostnameHint = "") {
  if (!webauthn) {
    throw new Error("WebAuthn library not available — npm install @simplewebauthn/server");
  }
  const rpID = RP_ID || hostnameHint || "localhost";

  // userID must be unique per ceremony. We use a fresh random per
  // consent so that re-attempts (after failed scans) don't collide.
  const userID = Buffer.from(crypto.randomBytes(16));

  const options = await webauthn.generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID,
    // Human-readable handle. Shown by some authenticators (rarely on
    // Windows Hello) — keep it descriptive for audit.
    userName: `${(consent.consentingParty?.name || "Consenting Party")} - ${consent.consentType} - ${consent._id}`,
    userDisplayName: consent.consentingParty?.name || "Consenting Party",
    // We DON'T want resident keys (the credential should not persist on
    // the device beyond this ceremony). residentKey: discouraged tells
    // the platform "don't save this".
    authenticatorSelection: {
      authenticatorAttachment: "platform",   // built-in scanners (Windows Hello, Touch ID)
      userVerification: "required",          // must actually scan, not just click "OK"
      residentKey: "discouraged",
    },
    // none = simplest attestation, sufficient for our audit needs
    attestationType: "none",
    timeout: CHALLENGE_TTL_MS,
  });

  return {
    options,
    expectedChallenge: options.challenge,
    expectedChallengeExpiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  };
}

/**
 * Verify the attestation response coming back from the browser.
 *
 * @param {object} response — raw RegistrationResponseJSON from the browser
 * @param {string} expectedChallenge — the challenge stored on the consent doc
 * @param {string} originHint — req.headers.origin (used for verification)
 * @param {string} hostnameHint — req.hostname (used as rpID fallback)
 * @returns {object} {verified, credentialId, publicKey, counter, fmt, aaguid}
 */
async function verifyRegistrationResponse(response, expectedChallenge, originHint = "", hostnameHint = "") {
  if (!webauthn) {
    throw new Error("WebAuthn library not available");
  }
  if (!expectedChallenge) {
    throw new Error("No pending challenge — request fresh options first");
  }
  const rpID = RP_ID || hostnameHint || "localhost";
  // expectedOrigin accepts an array; allow the browser-reported origin
  // and the env-configured one so a dev/prod mismatch doesn't reject.
  const expectedOrigin = [ORIGIN_FALLBACK];
  if (originHint && !expectedOrigin.includes(originHint)) expectedOrigin.push(originHint);

  const verification = await webauthn.verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified) {
    return { verified: false };
  }

  // @simplewebauthn/server@11 stores credential data on
  // `verification.registrationInfo.credential` (changed from `.credentialID`
  // in older versions). Handle both shapes defensively.
  const info = verification.registrationInfo || {};
  const cred = info.credential || {};
  const credentialIdRaw =
    cred.id || info.credentialID || null;
  const publicKeyRaw =
    cred.publicKey || info.credentialPublicKey || null;
  const counter = cred.counter ?? info.counter ?? 0;
  const fmt = info.fmt || "";
  const aaguid = info.aaguid || cred.aaguid || "";

  // R7gh — Classify the authenticator BEFORE telling the caller it's
  // verified. The cryptographic verification only proves the signature
  // matched; it does NOT prove the signer was a real hardware scanner.
  // Hardware enforcement is what makes this attestation NABH-grade
  // evidence rather than "user clicked a button on a virtual key".
  const cls = classifyAaguid(aaguid);
  if (STRICT_HARDWARE && !cls.isHardware) {
    return {
      verified: false,
      hardwareRejected: true,
      rejectReason: cls.rejectReason,
      aaguid,
    };
  }

  return {
    verified: true,
    credentialId: credentialIdRaw ? Buffer.from(credentialIdRaw).toString("base64url") : "",
    publicKey:    publicKeyRaw    ? Buffer.from(publicKeyRaw).toString("base64url")    : "",
    counter,
    attestationFmt: fmt,
    aaguid,
    // R7gh — pass hardware classification up so the controller can
    // persist it on the ConsentForm doc + surface it in the response.
    isHardwareBacked: cls.isHardware,
    authenticatorVendor: cls.vendor,
  };
}

module.exports = {
  makeRegistrationOptions,
  verifyRegistrationResponse,
  classifyAaguid,
  HARDWARE_AAGUIDS,
  REJECTED_AAGUIDS,
  STRICT_HARDWARE,
  CHALLENGE_TTL_MS,
};
